import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_GRAPH_SCHEMA, REASONING_SCHEMA } from "./constants.mjs";
import { discoverAssets } from "./catalog.mjs";
import { digest, option, options, readYaml, redact, safeId, unique, walkFiles, writeJson } from "./utils.mjs";

const TEXT_EXTENSIONS = new Set([".md", ".txt", ".rst", ".adoc", ".yaml", ".yml", ".json", ".xml", ".toml", ".properties", ".gradle", ".java", ".kt", ".go", ".rs", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".c", ".cc", ".cpp", ".h", ".hpp", ".sql", ".sh"]);
const BUILD_FILES = new Set(["pom.xml", "build.gradle", "build.gradle.kts", "package.json", "go.mod", "cargo.toml", "makefile", "cmakelists.txt", "requirements.txt", "pyproject.toml", "dockerfile", "compose.yaml", "docker-compose.yml"]);
const EVIDENCE_EXTRACTION_COMMANDS = new Set(["pdftotext", "unzip", "curl"]);

export function loadKnowledge(home) {
  const ontologyFile = latestYaml(path.join(home, "ontology"), "OntologyPack");
  const matcherFile = latestYaml(path.join(home, "policies/matcher"), "MatchPolicyPack");
  if (!ontologyFile || !matcherFile) throw new Error("Workspace is missing a published OntologyPack or MatchPolicyPack.");
  return { ontology: readYaml(ontologyFile), ontologyFile, policy: readYaml(matcherFile), policyFile: matcherFile };
}

export function collectEvidence(args, home, { projectOverride } = {}) {
  const runId = safeId(option(args, "run-id", `run-${new Date().toISOString()}-${Math.random().toString(16).slice(2, 10)}`));
  const runRoot = path.join(home, "evolution-runs", runId);
  fs.mkdirSync(runRoot, { recursive: true });
  const inputs = [];
  const sourceProjects = projectOverride ? [projectOverride] : options(args, "source-project");
  for (const project of sourceProjects) inputs.push({ type: "source-project", input: path.resolve(project) });
  for (const file of options(args, "attachment")) inputs.push({ type: "attachment", input: path.resolve(file) });
  for (const file of options(args, "production-log")) inputs.push({ type: "runtime-log", input: path.resolve(file) });
  for (const file of options(args, "historical-harness")) inputs.push({ type: "historical-harness", input: path.resolve(file) });
  for (const note of options(args, "note")) inputs.push({ type: "operator-note", input: note, inline: true });
  const goal = option(args, "goal");
  if (goal) inputs.push({ type: "operator-note", input: goal, inline: true, goal: true });
  for (const repository of options(args, "github-repo")) {
    const checkout = checkoutGitHub(repository, option(args, "github-ref", "main"), path.join(home, "cache/github"));
    inputs.push({ type: "github-repository", input: checkout.path, github: checkout });
  }
  for (const url of options(args, "research-url")) {
    if (!args.options["allow-internet-research"]) throw new Error("--research-url requires explicit --allow-internet-research.");
    inputs.push({ type: "internet-research", input: url, inline: true, research: true });
  }
  if (!inputs.length) throw new Error("Provide --source-project, --source-root, --github-repo, --attachment, --production-log, or --note.");

  const rawNodes = [];
  const sourceRecords = [];
  for (const input of inputs) {
    const before = rawNodes.length;
    if (input.inline) {
      const text = input.research ? fetchResearch(input.input) : input.input;
      rawNodes.push(nodeFromText(input.type === "internet-research" ? "research-evidence" : input.type, input.research ? input.input : input.goal ? "goal" : "note", text, { source: input.input, sourceType: input.type, authority: input.research ? "supplemental" : "local" }));
    } else if (["source-project", "github-repository"].includes(input.type)) {
      scanProject(input.input, input.type, rawNodes);
    } else {
      rawNodes.push(nodeFromFile(input.input, input.type));
    }
    sourceRecords.push({
      type: input.type,
      input: input.inline ? "inline" : input.input,
      github: input.github,
      authority: input.research ? "supplemental" : "local",
      evidenceNodeCount: rawNodes.length - before
    });
  }
  const snapshotRoot = path.join(home, "evidence", runId);
  fs.mkdirSync(snapshotRoot, { recursive: true });
  const nodes = rawNodes.filter(Boolean).map((node, index) => {
    const evidenceId = `evidence-${String(index + 1).padStart(4, "0")}`;
    const snapshotFile = path.join(snapshotRoot, `${evidenceId}.txt`);
    fs.writeFileSync(snapshotFile, node.excerpt, "utf8");
    return { ...node, evidenceId, snapshotRef: snapshotFile };
  });
  const graph = {
    schema: EVIDENCE_GRAPH_SCHEMA,
    runId,
    createdAt: new Date().toISOString(),
    redactionApplied: true,
    sourceCount: sourceRecords.length,
    nodeCount: nodes.length,
    sources: sourceRecords,
    nodes
  };
  graph.graphDigest = digest(graph);
  writeJson(path.join(runRoot, "evidence-graph.json"), graph);
  writeJson(path.join(snapshotRoot, "manifest.json"), { schema: "evopilot-harness-redacted-snapshot/v1", runId, graphDigest: graph.graphDigest, files: nodes.map((node) => ({ evidenceId: node.evidenceId, snapshotRef: node.snapshotRef, excerptDigest: node.excerptDigest })) });
  return { runId, runRoot, graph };
}

export function discoverSourceProjects(root, { includeModules = false, limit = 100 } = {}) {
  const resolved = path.resolve(root);
  const markers = new Set(["pom.xml", "package.json", "go.mod", "cargo.toml", "pyproject.toml", "build.gradle", "build.gradle.kts", "makefile", "cmakelists.txt"]);
  const discovered = new Set();
  for (const file of walkFiles(resolved, (candidate) => markers.has(path.basename(candidate).toLowerCase()))) {
    discovered.add(path.dirname(file));
  }
  if (!discovered.size && fs.existsSync(resolved)) discovered.add(resolved);
  const ordered = [...discovered].sort((a, b) => a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b));
  const projects = includeModules ? ordered : ordered.filter((directory, index) => !ordered.slice(0, index).some((parent) => directory.startsWith(`${parent}${path.sep}`)));
  return projects.slice(0, limit);
}

export function reasonEvidence(graph, home) {
  const knowledge = loadKnowledge(home);
  const enriched = enrichEvidenceGraph(graph, knowledge.ontology);
  const eligibility = eligibilityGate(enriched, knowledge.policy);
  const assetRoots = [path.join(home, "catalogs/organization/assets"), path.join(home, "catalogs/builtin/assets")];
  const profiles = discoverAssets(assetRoots).filter((record) => record.asset.kind === "HarnessProfile");
  const candidates = retrieveAndScore(enriched, profiles, knowledge);
  const decision = decide(eligibility, candidates, knowledge.policy, enriched, knowledge.ontology);
  const result = {
    schema: REASONING_SCHEMA,
    algorithmVersion: "eligibility-bm25-multifactor/v3",
    ontology: { id: knowledge.ontology.metadata.id, version: knowledge.ontology.metadata.version, digest: digest(knowledge.ontology) },
    policy: { id: knowledge.policy.metadata.id, version: knowledge.policy.metadata.version, digest: digest(knowledge.policy) },
    evidenceGraph: { runId: graph.runId, graphDigest: enriched.graphDigest, nodeCount: enriched.nodes.length },
    eligibility,
    decision: decision.decision,
    targetProfile: decision.targetProfile,
    composeProfiles: decision.composeProfiles,
    proposedProfile: decision.proposedProfile,
    confidence: decision.confidence,
    advisorRequired: knowledge.policy.spec.risk.advisorRequiredFor.includes(decision.decision),
    humanApprovalRequired: knowledge.policy.spec.risk.humanApprovalRequiredFor.includes(decision.decision),
    candidates,
    rejectionReasons: decision.rejectionReasons,
    evidenceIds: decision.evidenceIds,
    nextAction: nextAction(decision.decision)
  };
  return { graph: enriched, result, knowledge };
}

export function reasonCorpus(args, home) {
  const root = option(args, "source-root");
  if (!root) throw new Error("Corpus reasoning requires --source-root.");
  const projects = discoverSourceProjects(root, {
    includeModules: args.options["include-modules"] === true,
    limit: Number(option(args, "limit", 100))
  });
  const runs = projects.map((project) => {
    const evidence = collectEvidence(args, home, { projectOverride: project });
    const reasoned = reasonEvidence(evidence.graph, home);
    return { project, runId: evidence.runId, runRoot: evidence.runRoot, graph: reasoned.graph, reasoning: reasoned.result, knowledge: reasoned.knowledge };
  });
  const groups = new Map();
  for (const run of runs) {
    const assetId = run.reasoning.targetProfile?.id
      ?? run.reasoning.proposedProfile?.id
      ?? run.reasoning.composeProfiles?.map((profile) => profile.id).sort().join("-and-")
      ?? run.reasoning.decision;
    const key = `${run.reasoning.decision}:${assetId}`;
    const group = groups.get(key) ?? {
      groupId: safeId(assetId),
      decision: run.reasoning.decision,
      targetProfile: run.reasoning.targetProfile,
      proposedProfile: run.reasoning.proposedProfile,
      composeProfiles: run.reasoning.composeProfiles,
      projects: [],
      runIds: [],
      evidenceDigests: []
    };
    group.projects.push(run.project);
    group.runIds.push(run.runId);
    group.evidenceDigests.push(run.graph.graphDigest);
    groups.set(key, group);
  }
  return {
    schema: "evopilot-harness-corpus-reasoning/v3",
    status: runs.length ? "REVIEW_REQUIRED" : "INSUFFICIENT_EVIDENCE",
    sourceRoot: path.resolve(root),
    discoveredProjectCount: projects.length,
    groupCount: groups.size,
    groups: [...groups.values()],
    runs: runs.map((run) => ({ project: run.project, runId: run.runId, reasoning: run.reasoning })),
    nextAction: "review-corpus-groups"
  };
}

function enrichEvidenceGraph(graph, ontology) {
  const concepts = ontology.spec.concepts;
  const nodes = graph.nodes.map((node) => {
    const normalized = node.excerpt.toLowerCase();
    const matches = concepts.filter((concept) => concept.terms.some((term) => normalized.includes(String(term).toLowerCase()))).map((concept) => concept.id);
    return { ...node, concepts: unique(matches) };
  });
  const enriched = { ...graph, nodes };
  const digestInput = { ...enriched };
  delete digestInput.graphDigest;
  enriched.graphDigest = digest(digestInput);
  return enriched;
}

function eligibilityGate(graph, policy) {
  const config = policy.spec.eligibility;
  const text = graph.nodes.map((node) => node.excerpt.toLowerCase()).join("\n");
  const rejectMatches = config.rejectTerms.filter((term) => text.includes(String(term).toLowerCase()));
  const actionMatches = config.actionTerms.filter((term) => text.includes(String(term).toLowerCase()));
  const engineeringNodes = graph.nodes.filter((node) => ["source-code", "build-manifest", "architecture-document", "runtime-log", "github-repository"].includes(node.kind));
  const manifestAction = graph.nodes.some((node) => node.kind === "build-manifest") ? ["build-manifest"] : [];
  const actionSignals = unique([...actionMatches, ...manifestAction]);
  let decision = "ELIGIBLE";
  const reasons = [];
  if (rejectMatches.length) {
    decision = "NOT_HARNESS_ELIGIBLE";
    reasons.push(`Rejected non-engineering source signals: ${rejectMatches.join(", ")}`);
  } else if (!engineeringNodes.length && !actionSignals.length) {
    decision = "NOT_HARNESS_ELIGIBLE";
    reasons.push("No repeatable engineering action or model-external execution environment was evidenced.");
  } else if (graph.nodes.length < config.minimumEvidenceNodes || actionSignals.length < config.minimumActionSignals) {
    decision = "INSUFFICIENT_EVIDENCE";
    reasons.push(`Need at least ${config.minimumEvidenceNodes} evidence nodes and ${config.minimumActionSignals} action signal.`);
  } else {
    reasons.push("Evidence supports a repeatable engineering task with external actions, constraints, evidence, or validators.");
  }
  return {
    schema: "evopilot-harness-eligibility/v1",
    decision,
    evidenceNodeCount: graph.nodes.length,
    engineeringNodeCount: engineeringNodes.length,
    actionSignals,
    rejectMatches,
    reasons,
    evidenceIds: unique([...engineeringNodes.slice(0, 5).map((node) => node.evidenceId), ...graph.nodes.filter((node) => node.kind === "build-manifest").slice(0, 3).map((node) => node.evidenceId)])
  };
}

function retrieveAndScore(graph, profiles, knowledge) {
  if (!profiles.length) return [];
  const queryTokens = tokenize(graph.nodes.map((node) => `${node.excerpt} ${(node.concepts ?? []).join(" ")}`).join(" "));
  const docs = profiles.map((record) => profileDocument(record));
  const bm25Scores = bm25(queryTokens, docs.map((doc) => doc.tokens), knowledge.policy.spec.retrieval);
  const maxBm25 = Math.max(...bm25Scores, 0.0001);
  const detectedConcepts = unique(graph.nodes.flatMap((node) => node.concepts ?? []));
  const evidenceKinds = unique(graph.nodes.map((node) => node.kind));
  const detectedRole = detectRole(graph, knowledge.ontology);
  const weights = knowledge.policy.spec.weights;
  const candidates = profiles.map((record, index) => {
    const profile = record.asset;
    const positive = profile.spec.match.positiveConcepts;
    const ontologyNegative = knowledge.ontology.spec.roles.filter((item) => item.domain === profile.spec.classification.domain).flatMap((item) => item.negativeConcepts ?? []);
    const negative = unique([...profile.spec.match.negativeConcepts, ...ontologyNegative]);
    const role = detectedRole?.id === profile.spec.classification.role ? 1 : detectedRole?.domain === profile.spec.classification.domain ? 0.65 : 0;
    const boundary = overlap(positive, detectedConcepts);
    const capability = bm25Scores[index] / maxBm25;
    const execution = graph.nodes.some((node) => node.kind === "build-manifest") ? 1 : 0.5;
    const evidence = overlap(profile.spec.match.requiredEvidenceKinds, evidenceKinds);
    const negativeConflict = overlap(negative, detectedConcepts);
    const novelty = Math.max(0, 1 - boundary);
    const positiveWeight = weights.role + weights.boundary + weights.capability + weights.execution + weights.evidence;
    const positiveScore = (role * weights.role + boundary * weights.boundary + capability * weights.capability + execution * weights.execution + evidence * weights.evidence) / positiveWeight;
    const total = clamp(positiveScore - negativeConflict * weights.negativeConflict - novelty * weights.novelty);
    const evidenceIds = graph.nodes.filter((node) => (node.concepts ?? []).some((concept) => positive.includes(concept))).slice(0, 8).map((node) => node.evidenceId);
    return {
      rank: 0,
      id: profile.metadata.id,
      version: profile.metadata.version,
      domain: profile.spec.classification.domain,
      role: profile.spec.classification.role,
      totalScore: round(total),
      bm25Score: round(bm25Scores[index]),
      factors: { role: round(role), boundary: round(boundary), capability: round(capability), execution: round(execution), evidenceCoverage: round(evidence), negativeConflict: round(negativeConflict), novelty: round(novelty) },
      evidenceIds,
      rejectionReasons: [
        ...(negativeConflict > 0 ? [`Negative concept conflict=${round(negativeConflict)}`] : []),
        ...(boundary === 0 ? ["No positive ontology concept overlap."] : []),
        ...(evidence < 1 ? [`Required evidence coverage=${round(evidence)}`] : [])
      ]
    };
  }).sort((a, b) => b.totalScore - a.totalScore || a.id.localeCompare(b.id));
  return candidates.slice(0, knowledge.policy.spec.retrieval.topK).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function decide(eligibility, candidates, policy, graph, ontology) {
  if (eligibility.decision !== "ELIGIBLE") {
    return { decision: eligibility.decision, confidence: 1, rejectionReasons: eligibility.reasons, evidenceIds: eligibility.evidenceIds };
  }
  const domainConcepts = unique(graph.nodes.flatMap((node) => node.concepts ?? []).filter((concept) => concept !== "executable-engineering"));
  const detectedRole = detectRole(graph, ontology);
  const proposedProfile = proposedProfileIntent(detectedRole, domainConcepts, graph);
  if (!candidates.length) {
    return { decision: "PROPOSE_NEW_PROFILE", proposedProfile, confidence: 0.7, rejectionReasons: ["No published HarnessProfile candidates exist."], evidenceIds: eligibility.evidenceIds };
  }
  if (!domainConcepts.length) {
    return { decision: "PROPOSE_NEW_PROFILE", proposedProfile, confidence: 0.7, rejectionReasons: ["No published Ontology concept explains the evidenced engineering domain; an Ontology/Profile proposal is required."], evidenceIds: eligibility.evidenceIds };
  }
  if (detectedRole && detectedRole.matched - detectedRole.conflicts > 0 && !candidates.some((candidate) => candidate.domain === detectedRole.domain)) {
    return { decision: "PROPOSE_NEW_PROFILE", proposedProfile, confidence: 0.82, rejectionReasons: [`Detected role ${detectedRole.id} has no published HarnessProfile in domain ${detectedRole.domain}.`], evidenceIds: unique([...eligibility.evidenceIds, ...graph.nodes.filter((node) => (node.concepts ?? []).some((concept) => detectedRole.concepts.includes(concept))).map((node) => node.evidenceId).slice(0, 8)]) };
  }
  const [top, second] = candidates;
  const thresholds = policy.spec.thresholds;
  const delta = top.totalScore - (second?.totalScore ?? 0);
  if (top.factors.negativeConflict >= 0.5 && top.factors.role === 0) {
    return { decision: "PROPOSE_NEW_PROFILE", proposedProfile, confidence: round(Math.max(0.7, 1 - top.totalScore)), rejectionReasons: ["The best existing profile has a strong negative boundary conflict and no role match.", ...top.rejectionReasons], evidenceIds: unique([...eligibility.evidenceIds, ...top.evidenceIds]) };
  }
  if (top.totalScore <= thresholds.newProfileMaximum) {
    return { decision: "PROPOSE_NEW_PROFILE", proposedProfile, confidence: round(1 - top.totalScore), rejectionReasons: [`Best existing profile score ${top.totalScore} is at or below new-profile maximum ${thresholds.newProfileMaximum}.`, ...top.rejectionReasons], evidenceIds: unique([...eligibility.evidenceIds, ...top.evidenceIds]) };
  }
  if (second && top.totalScore >= thresholds.composeBundle && second.totalScore >= thresholds.composeBundle && top.domain !== second.domain && delta >= thresholds.ambiguousDelta) {
    return { decision: "COMPOSE_NEW_BUNDLE", confidence: round((top.totalScore + second.totalScore) / 2), composeProfiles: [pickProfile(top), pickProfile(second)], rejectionReasons: ["Evidence spans two independently strong profile boundaries."], evidenceIds: unique([...top.evidenceIds, ...second.evidenceIds]) };
  }
  if (second && delta < thresholds.ambiguousDelta) {
    return { decision: "REVIEW_REQUIRED", confidence: round(top.totalScore), targetProfile: pickProfile(top), rejectionReasons: [`Top-candidate delta ${round(delta)} is below ambiguity threshold ${thresholds.ambiguousDelta}.`], evidenceIds: unique([...top.evidenceIds, ...second.evidenceIds]) };
  }
  if (top.totalScore >= thresholds.evolveExisting) {
    return { decision: "EVOLVE_EXISTING", confidence: round(top.totalScore), targetProfile: pickProfile(top), rejectionReasons: top.rejectionReasons, evidenceIds: unique([...eligibility.evidenceIds, ...top.evidenceIds]) };
  }
  return { decision: "REVIEW_REQUIRED", confidence: round(top.totalScore), targetProfile: pickProfile(top), rejectionReasons: [`Best score ${top.totalScore} does not reach evolve-existing threshold ${thresholds.evolveExisting}.`, ...top.rejectionReasons], evidenceIds: unique([...eligibility.evidenceIds, ...top.evidenceIds]) };
}

function detectRole(graph, ontology) {
  const conceptSet = new Set(unique(graph.nodes.flatMap((node) => node.concepts ?? [])));
  const role = ontology.spec.roles.map((item) => ({
    ...item,
    matched: item.concepts.filter((concept) => concept !== "executable-engineering" && conceptSet.has(concept)).length,
    conflicts: (item.negativeConcepts ?? []).filter((concept) => conceptSet.has(concept)).length
  })).sort((a, b) => (b.matched - b.conflicts) - (a.matched - a.conflicts) || b.matched - a.matched || a.id.localeCompare(b.id))[0];
  return role && role.matched > role.conflicts ? role : undefined;
}

function proposedProfileIntent(role, domainConcepts, graph) {
  const domain = safeId(role?.domain ?? domainConcepts[0] ?? "unclassified-engineering");
  const id = safeId(`${domain}-profile`);
  const evidencedConcepts = new Set(graph.nodes.flatMap((node) => node.concepts ?? []));
  const positiveConcepts = unique((role?.concepts ?? domainConcepts).filter((concept) => evidencedConcepts.has(concept)));
  return {
    id,
    domain,
    role: safeId(role?.id ?? (domain === "unclassified-engineering" ? domain : `${domain}-engineering`)),
    taskClass: safeId(role?.taskClass ?? "engineering-task"),
    positiveConcepts: unique([...positiveConcepts, "executable-engineering"]),
    negativeConcepts: unique(role?.negativeConcepts ?? []),
    evidenceKinds: unique(graph.nodes.map((node) => node.kind))
  };
}

function scanProject(root, sourceType, nodes) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Source project does not exist or is not a directory: ${root}`);
  const files = walkFiles(root, (file) => isRelevantFile(file)).slice(0, 300);
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join("/");
    const node = nodeFromFile(file, sourceType, relative);
    if (node) nodes.push(node);
  }
}

function nodeFromFile(file, sourceType, relative = path.basename(file)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`Source file does not exist: ${file}`);
  const stat = fs.statSync(file);
  const extension = path.extname(file).toLowerCase();
  let content = "";
  if (extension === ".pdf") content = extractCommand("pdftotext", [file, "-"]);
  else if ([".docx", ".pptx"].includes(extension)) content = extractOffice(file);
  else if (stat.size <= 256_000) content = fs.readFileSync(file, "utf8");
  const kind = inferKind(file, sourceType);
  return nodeFromText(kind, relative, content || `${path.basename(file)} binary-or-unreadable attachment`, { source: file, sourceType, rawDigest: digest(fs.readFileSync(file)) });
}

function nodeFromText(kind, label, content, metadata = {}) {
  const redacted = redact(content).slice(0, 24_000);
  return {
    kind,
    label,
    sourceRef: metadata.source,
    sourceType: metadata.sourceType ?? kind,
    authority: metadata.authority ?? "local",
    sourceDigest: metadata.rawDigest ?? digest(String(content)),
    excerptDigest: digest(redacted),
    excerpt: redacted,
    redactionApplied: redacted !== String(content)
  };
}

function inferKind(file, sourceType) {
  if (sourceType === "runtime-log") return "runtime-log";
  if (sourceType === "attachment") return "attachment";
  if (sourceType === "historical-harness") return "historical-harness";
  if (BUILD_FILES.has(path.basename(file).toLowerCase())) return "build-manifest";
  if (/readme|architecture|design|adr|docs?/i.test(file)) return "architecture-document";
  return sourceType === "github-repository" ? "github-repository" : "source-code";
}

function isRelevantFile(file) {
  const name = path.basename(file).toLowerCase();
  return BUILD_FILES.has(name) || TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) || /readme|architecture|design|adr/i.test(name);
}

function checkoutGitHub(repository, ref, cacheRoot) {
  if (/^https?:\/\/[^/]*@/i.test(repository)) throw new Error("Do not include credentials in --github-repo. Use local Git credential management or SSH.");
  const remote = normalizeRepository(repository);
  const id = safeId(repository.replace(/\.git$/, ""));
  const checkout = path.join(cacheRoot, id);
  fs.mkdirSync(cacheRoot, { recursive: true });
  if (fs.existsSync(path.join(checkout, ".git"))) {
    execFileSync("git", ["-C", checkout, "fetch", "--depth", "1", "origin", ref], { stdio: "pipe" });
    execFileSync("git", ["-C", checkout, "checkout", "--detach", "FETCH_HEAD"], { stdio: "pipe" });
  } else {
    execFileSync("git", ["clone", "--depth", "1", "--branch", ref, remote, checkout], { stdio: "pipe" });
  }
  const resolvedCommit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { repository, remote, ref, resolvedCommit, path: checkout };
}

function normalizeRepository(repository) {
  if (repository.startsWith("file:") || repository.startsWith("http:") || repository.startsWith("https:") || repository.startsWith("ssh:") || repository.startsWith("git@") || path.isAbsolute(repository)) return repository;
  if (/^[\w.-]+\/[\w.-]+$/.test(repository)) return `https://github.com/${repository.replace(/\.git$/, "")}.git`;
  return repository;
}

function extractOffice(file) {
  const pattern = file.endsWith(".docx") ? "word/document.xml" : "ppt/slides/*.xml";
  return extractCommand("unzip", ["-p", file, pattern]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function extractCommand(command, args) {
  if (!EVIDENCE_EXTRACTION_COMMANDS.has(command)) throw new Error(`Evidence extraction command is not allowed: ${command}`);
  try { return execFileSync(command, args, { encoding: "utf8", maxBuffer: 2_000_000 }); } catch { return ""; }
}

function fetchResearch(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Invalid --research-url: ${value}`); }
  if (url.protocol !== "https:") throw new Error("Internet research requires an https URL.");
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) throw new Error("Internet research cannot access local or private network addresses.");
  const content = extractCommand("curl", ["--fail", "--silent", "--show-error", "--location", "--max-time", "15", "--max-filesize", "1000000", url.href]);
  if (!content) throw new Error(`Internet research returned no usable evidence: ${url.href}`);
  return content.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 24_000);
}

function latestYaml(root, kind) {
  const files = walkFiles(root, (file) => /\.ya?ml$/i.test(file));
  return files.map((file) => {
    try { return { file, document: readYaml(file) }; } catch { return null; }
  }).filter((item) => item?.document?.kind === kind && ["published", "approved"].includes(item.document.metadata?.lifecycle)).sort((a, b) => String(b.document.metadata.version).localeCompare(String(a.document.metadata.version), undefined, { numeric: true }))[0]?.file;
}

function profileDocument(record) {
  const profile = record.asset;
  const text = [profile.metadata.name, profile.metadata.description, profile.spec.classification.domain, profile.spec.classification.role, ...profile.spec.boundary.inScope, ...profile.spec.boundary.outOfScope, ...profile.spec.match.positiveConcepts, ...profile.spec.match.negativeConcepts].join(" ");
  return { record, tokens: tokenize(text) };
}

function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z0-9][a-z0-9._-]+|[\u4e00-\u9fff]{2,}/g) ?? [];
}

function bm25(query, documents, config) {
  const queryTerms = unique(query);
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / Math.max(1, documents.length);
  return documents.map((document) => {
    const frequencies = new Map();
    for (const term of document) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    return queryTerms.reduce((score, term) => {
      const frequency = frequencies.get(term) ?? 0;
      if (!frequency) return score;
      const containing = documents.filter((candidate) => candidate.includes(term)).length;
      const idf = Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5));
      const denominator = frequency + config.bm25K1 * (1 - config.bm25B + config.bm25B * document.length / Math.max(1, averageLength));
      return score + idf * (frequency * (config.bm25K1 + 1)) / denominator;
    }, 0);
  });
}

function overlap(expected = [], actual = []) {
  if (!expected.length) return 1;
  const actualSet = new Set(actual);
  return expected.filter((item) => actualSet.has(item)).length / expected.length;
}

function pickProfile(candidate) {
  return { id: candidate.id, version: candidate.version, domain: candidate.domain, role: candidate.role, score: candidate.totalScore };
}

function clamp(value) { return Math.max(0, Math.min(1, value)); }
function round(value) { return Math.round(Number(value) * 10000) / 10000; }

function nextAction(decision) {
  return ({
    EVOLVE_EXISTING: "review-profile-delta",
    COMPOSE_NEW_BUNDLE: "review-bundle-composition",
    PROPOSE_NEW_PROFILE: "run-advisor-and-review-profile-proposal",
    INSUFFICIENT_EVIDENCE: "provide-more-source-evidence",
    NOT_HARNESS_ELIGIBLE: "stop-not-harness-asset",
    REVIEW_REQUIRED: "run-advisor-and-resolve-ambiguity"
  })[decision];
}
