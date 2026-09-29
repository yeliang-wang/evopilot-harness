import { digest, persistedJson } from "./utils.mjs";

// Generic fields; values come from frozen, redacted Source evidence.
const FIELD_LABELS = {
  businessObjects: ["business object", "entities", "entity", "业务对象", "实体"],
  capabilities: ["capability", "能力"],
  tasks: ["task", "task classes", "task class", "任务", "任务类别", "任务目标"],
  roles: ["role", "actors", "actor", "角色", "角色设定"],
  constraints: ["constraint", "policies", "policy", "约束", "规则"],
  workflows: ["workflow", "processes", "process", "工作流", "流程"],
  failureModes: ["failure mode", "failures", "失败模式"],
  recoveryStrategies: ["recovery strategy", "recovery rules", "recovery", "恢复策略", "恢复规则"],
  validators: ["validator", "validation", "验证器", "验证规则"],
  positiveCases: ["positive case", "正向用例"],
  negativeCases: ["negative case", "负向用例"],
  risks: ["risk", "风险"],
  expectedEffects: ["expected effect", "outcomes", "outcome", "预期效果", "预期结果"],
  counterEvidence: ["反向证据"]
};
export const PROFESSIONAL_SOURCE_FIELDS = Object.freeze(Object.keys(FIELD_LABELS));
const normalize = value => String(value).normalize("NFKC").replace(/[\s_*-]/g, "").toLowerCase();
const FIELDS = new Map(Object.entries(FIELD_LABELS).flatMap(([field, labels]) => [field, ...labels].map(label => [normalize(label), field])));
const LIMIT = 512;

export function deriveProfessionalEvidence(graph, nodes = graph.nodes) {
  const facts = [], rejectedEvidence = [], seen = new Set();
  let truncated = false;
  for (const node of [...(nodes ?? [])].sort((a, b) => compare(String(a.evidenceId), String(b.evidenceId)))) {
    if (!node.evidenceId || typeof node.excerpt !== "string" || !node.excerptDigest || !node.sourceDigest) {
      rejectedEvidence.push({ evidenceId: node.evidenceId ?? null, reason: "IMMUTABLE_CONTENT_BINDING_UNAVAILABLE" });
      continue;
    }
    if (digest(node.excerpt) !== node.excerptDigest) {
      rejectedEvidence.push({ evidenceId: node.evidenceId, reason: "IMMUTABLE_CONTENT_BINDING_MISMATCH" });
      continue;
    }
    const add = (field, value, locator, method) => {
      if (typeof value !== "string" || !value.trim()) return;
      const text = value.trim();
      if (text.length > 1000 || facts.length >= LIMIT) { truncated = true; return; }
      const key = digest({ field, text, evidenceId: node.evidenceId, locator });
      if (seen.has(key)) return;
      seen.add(key);
      facts.push({ field, value: text, evidenceId: node.evidenceId, sourceRef: node.sourceRef ?? node.label,
        sourceDigest: node.sourceDigest, excerptDigest: node.excerptDigest, locator, extractionMethod: method,
        uncertainty: method.endsWith("_CANDIDATE") ? "STRUCTURAL_CANDIDATE_REQUIRES_SEMANTIC_REVIEW" : "SOURCE_DECLARATION_NOT_INDEPENDENTLY_VALIDATED", authority: "EVIDENCE_ONLY" });
    };
    let document;
    try { document = JSON.parse(node.excerpt); } catch { /* Static prose. */ }
    if (document && typeof document === "object") {
      const visit = (value, pointer = "", depth = 0) => {
        if (depth > 12 || facts.length >= LIMIT) { truncated = true; return; }
        for (const [key, child] of Object.entries(value)) {
          const at = pointer + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"), field = FIELDS.get(normalize(key));
          if (field) for (const [index, item] of (Array.isArray(child) ? child : [child]).entries()) {
            add(field, item, { jsonPointer: at + (Array.isArray(child) ? "/" + index : "") }, "STATIC_DECLARED_FIELD");
          }
          else if (child && typeof child === "object") visit(child, at, depth + 1);
        }
      };
      visit(document);
      continue;
    }
    let section = null;
    for (const [index, raw] of node.excerpt.split(/\r?\n/).entries()) {
      const line = raw.trim(), heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/);
      // Syntax candidates never decide Eligibility or Profile construction.
      if (/\.(?:[cm]?[jt]sx?|java|kt|py|go|rs|c|cc|cpp|h|hpp|sql)$/i.test(node.label ?? node.sourceRef ?? "")) {
        const type = line.match(/^(?:(?:export|public|private|internal|abstract|final|sealed|static|typedef)\s+)*(?:class|interface|struct|enum|type)\s+([A-Za-z_$][\w$]*)\b/);
        const callable = line.match(/^(?:(?:export|public|private|static|async|pub)\s+)*(?:function|def|fn|func)\s+([A-Za-z_$][\w$]*)\s*\(/);
        if (type) add("businessObjects", type[1], { line: index + 1 }, "STATIC_TYPE_DECLARATION_CANDIDATE");
        if (callable) add("tasks", callable[1], { line: index + 1 }, "STATIC_CALLABLE_DECLARATION_CANDIDATE");
      }
      if (heading) { section = FIELDS.get(normalize(heading[1])) ?? null; continue; }
      const declaration = line.match(/^(?:[-*+]\s+)?([^:：]{1,80})[:：]\s*(.*)$/);
      const field = declaration && FIELDS.get(normalize(declaration[1]));
      if (field) {
        section = field;
        add(field, declaration[2].replace(/^\*\*\s*/, ""), { line: index + 1 }, "STATIC_DECLARED_FIELD");
      } else if (section && /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
        add(section, line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, ""), { line: index + 1 }, "STATIC_DECLARED_SECTION");
      } else if (line) section = null;
    }
  }
  facts.sort((a, b) => compare(digest(a), digest(b)));
  const facets = Object.fromEntries(PROFESSIONAL_SOURCE_FIELDS.map(field => [field, [...new Set(facts.filter(f => f.field === field).map(f => f.value))].sort(compare)]));
  const result = { algorithm: "static-declared-professional-evidence/v1", graphDigest: graph.graphDigest,
    inspectedEvidenceIds: [...new Set((nodes ?? []).map(node => node.evidenceId))].sort(compare), facets, facts, rejectedEvidence,
    missingFields: PROFESSIONAL_SOURCE_FIELDS.filter(field => facets[field].length === 0),
    limits: { maxFacts: LIMIT, maxFactLength: 1000, maxStructuredDepth: 12, truncated },
    authority: { sourceExecution: false, advisorDerived: false, provesEligibility: false, mayApprove: false, mayPublish: false },
    knownLimits: ["Only explicitly declared static facts and source type/callable candidates are extracted; absent fields are unknown, never invented.", "A type or callable declaration is an unvalidated structural candidate, not an established business object or business task.", "Source declarations are evidence, not proof that a capability or validator has executed successfully."] };
  result.professionalEvidenceDigest = digest(result);
  return result;
}

export function verifyProfessionalEvidence(value, graph) {
  try {
    const { professionalEvidenceDigest, ...core } = value;
    if (digest(core) !== professionalEvidenceDigest || value.graphDigest !== graph.graphDigest) return false;
    const nodes = new Map(graph.nodes.map(node => [node.evidenceId, node]));
    const selected = value.inspectedEvidenceIds.map(id => nodes.get(id));
    if (selected.some(node => !node)) return false;
    return deriveProfessionalEvidence(graph, selected).professionalEvidenceDigest === professionalEvidenceDigest;
  } catch { return false; }
}

export function professionalFactsForSource(value, source) {
  if (!value) return {};
  const sourceRef = (source.ref ?? source.sourceRef ?? source.path)?.replaceAll("\\", "/");
  const facts = value.facts.filter(fact => (source.evidenceIds ?? []).includes(fact.evidenceId)
    || typeof sourceRef === "string" && (fact.sourceRef?.replaceAll("\\", "/") === sourceRef || fact.sourceRef?.replaceAll("\\", "/").startsWith(sourceRef.replace(/\/$/, "") + "/")));
  return { ...Object.fromEntries(PROFESSIONAL_SOURCE_FIELDS.map(field => [field, [...new Set(facts.filter(f => f.field === field).map(f => f.value))].sort(compare)])),
    facetEvidence: persistedJson(facts), professionalEvidenceDigest: value.professionalEvidenceDigest };
}

function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
