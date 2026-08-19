const state = {
  snapshot: undefined
};

const elements = {
  refresh: document.querySelector("#refresh"),
  catalogId: document.querySelector("#catalog-id"),
  catalogStatus: document.querySelector("#catalog-status"),
  entryCount: document.querySelector("#entry-count"),
  compatibleEvopilot: document.querySelector("#compatible-evopilot"),
  evolutionCount: document.querySelector("#evolution-count"),
  nextAction: document.querySelector("#next-action"),
  catalogPath: document.querySelector("#catalog-path"),
  catalogTable: document.querySelector("#catalog-table"),
  harnessCards: document.querySelector("#harness-cards"),
  evolutionList: document.querySelector("#evolution-list"),
  sourceTypes: document.querySelector("#source-types"),
  sourceProject: document.querySelector("#source-project"),
  goal: document.querySelector("#goal"),
  confirmedBy: document.querySelector("#confirmed-by"),
  commandPreview: document.querySelector("#command-preview"),
  assetCounts: document.querySelector("#asset-counts"),
  governanceList: document.querySelector("#governance-list"),
  llmUsage: document.querySelector("#llm-usage"),
  feedbackCounts: document.querySelector("#feedback-counts"),
  feedbackSummary: document.querySelector("#feedback-summary")
};

elements.refresh.addEventListener("click", () => loadSnapshot());
elements.sourceProject.addEventListener("input", updateCommandPreview);
elements.goal.addEventListener("input", updateCommandPreview);
elements.confirmedBy.addEventListener("input", updateCommandPreview);

loadSnapshot();

async function loadSnapshot() {
  elements.refresh.disabled = true;
  try {
    const response = await fetch("./api/hub/snapshot", { cache: "no-store" }).catch(() => undefined);
    if (response?.ok) {
      state.snapshot = await response.json();
    } else {
      const fallback = await fetch("./catalog-snapshot.json", { cache: "no-store" });
      state.snapshot = await fallback.json();
    }
    render();
  } catch (error) {
    renderError(error);
  } finally {
    elements.refresh.disabled = false;
  }
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const catalog = snapshot.catalog ?? {};
  elements.catalogId.textContent = catalog.catalogId ?? "missing";
  elements.catalogStatus.textContent = `${snapshot.status ?? "ATTENTION"} · ${catalog.catalogDigest ?? "digest missing"}`;
  elements.entryCount.textContent = String(catalog.entryCount ?? 0);
  elements.compatibleEvopilot.textContent = snapshot.schema?.endsWith("/v3") ? "Component / Profile / Bundle" : catalog.compatibleEvopilot ?? snapshot.project?.compatibleEvopilot ?? "compatible";
  elements.evolutionCount.textContent = String(snapshot.evolutions?.length ?? 0);
  elements.nextAction.textContent = snapshot.nextAction ?? "review";
  elements.catalogPath.textContent = catalog.catalogPath ?? "published/CATALOG.md";
  renderCatalogTable(catalog.entries ?? []);
  renderHarnessCards(snapshot.harnesses ?? []);
  renderEvolutions(snapshot.evolutions ?? []);
  renderSourceTypes(snapshot.sourceTypes ?? []);
  renderGovernance(snapshot.governancePacks ?? [], snapshot.evaluation ?? {}, snapshot.llmUsage ?? {});
  renderFeedback(snapshot.feedback ?? {});
  if (elements.assetCounts) {
    const counts = snapshot.assetCounts ?? {};
    elements.assetCounts.textContent = `components=${counts.HarnessComponent ?? 0} profiles=${counts.HarnessProfile ?? 0} bundles=${counts.HarnessBundle ?? 0}`;
  }
  updateCommandPreview();
}

function renderFeedback(feedback) {
  if (!elements.feedbackCounts || !elements.feedbackSummary) return;
  elements.feedbackCounts.textContent = `packages=${feedback.packageCount ?? 0} reports=${feedback.reportCount ?? 0}`;
  elements.feedbackSummary.innerHTML = "";
  const events = document.createElement("article");
  events.innerHTML = `<strong>Ingestion · accepted=${feedback.acceptedEventCount ?? 0} duplicate=${feedback.duplicateEventCount ?? 0} rejected=${feedback.rejectedEventCount ?? 0}</strong><small>${escapeHtml(JSON.stringify(feedback.rejectionReasons ?? {}))}</small>`;
  elements.feedbackSummary.append(events);
  const latest = feedback.latestReport;
  if (!latest) {
    elements.feedbackSummary.append(emptyCard("No effectiveness report yet."));
    return;
  }
  const summary = latest.summary ?? {};
  const dimensions = summary.dimensions ?? {};
  const report = document.createElement("article");
  report.innerHTML = `
    <strong>${escapeHtml(latest.reportId)} · samples=${summary.sampleCount ?? 0} sources=${summary.independentSourceCount ?? 0}</strong>
    <small>outcome=${dimensions.outcome?.successRate ?? "n/a"} process-retries=${dimensions.process?.averageRetryCount ?? "n/a"} safety=${dimensions.safety?.safeRate ?? "n/a"} tokens=${dimensions.cost?.averageTotalTokens ?? "n/a"}</small>
    <small>uncertainty=${escapeHtml(summary.uncertainty?.level ?? "UNKNOWN")} · ${escapeHtml(latest.reportDigest ?? "digest missing")}</small>
  `;
  elements.feedbackSummary.append(report);
}

function renderCatalogTable(entries) {
  elements.catalogTable.innerHTML = "";
  elements.catalogTable.append(row(["Asset", "Version", "Domain", "Status", "Kind", "Digest"], "head"));
  for (const entry of entries) {
    elements.catalogTable.append(row([
      entry.name ?? entry.id,
      entry.version,
      entry.domain ?? entry.layer ?? "-",
      pill(entry.status ?? "published", entry.status !== "published"),
      entry.kind ?? (entry.assetPath ? `${entry.assetApiVersion ?? "evopilot.dev/v2"} · ${entry.qualityStatus ?? "unchecked"}` : "-"),
      entry.digest ?? "-"
    ]));
  }
  if (entries.length === 0) elements.catalogTable.append(emptyRow("No published Harness entries."));
}

function renderHarnessCards(harnesses) {
  elements.harnessCards.innerHTML = "";
  for (const harness of harnesses) {
    const card = document.createElement("article");
    card.className = "card";
    const commands = harness.commands ?? {};
    card.innerHTML = `
      <header>
        <div>
          <h3>${escapeHtml(harness.name ?? harness.id)}</h3>
          <small>${escapeHtml(harness.id)}@${escapeHtml(harness.version)}</small>
        </div>
        ${pill(harness.lifecycleStatus ?? "active", harness.lifecycleStatus !== "active")}
      </header>
      <small>${escapeHtml(harness.description ?? harness.domain ?? "domain harness")}</small>
      <small>${escapeHtml(harness.kind ?? "HarnessProfile")} · ${escapeHtml(harness.domain ?? "product-neutral")}</small>
      <pre>${escapeHtml(commands.evolve ?? "evopilot-harness produce --source-project /path/to/project --goal \"...\" --json")}</pre>
    `;
    elements.harnessCards.append(card);
  }
  if (harnesses.length === 0) elements.harnessCards.append(emptyCard("No Harness packs found."));
}

function renderEvolutions(evolutions) {
  elements.evolutionList.innerHTML = "";
  for (const run of evolutions) {
    const item = document.createElement("article");
    item.innerHTML = `
      <strong>${escapeHtml(run.evolutionId)}</strong>
      <small>${escapeHtml(run.status)} · ${escapeHtml(run.targetHarnessId ?? "target pending")} · ${escapeHtml(run.reviewVerdict ?? "not-reviewed")} · ${escapeHtml(run.nextAction ?? "review")}</small>
      <small>delta=${escapeHtml(run.assetDelta?.status ?? "not-generated")} · operations=${escapeHtml(JSON.stringify(run.assetDelta?.operations ?? {}))} · impact=${escapeHtml(run.assetDelta?.impactStatus ?? "n/a")}</small>
      <small>compatibility=${escapeHtml(JSON.stringify(run.assetDelta?.compatibility ?? {}))} · blast=${escapeHtml(JSON.stringify(run.assetDelta?.blastRadius ?? {}))} · rollback=${escapeHtml(JSON.stringify(run.assetDelta?.rollback ?? {}))}</small>
      <small>evaluation=${escapeHtml(run.evaluationCoverage?.apiVersion ?? "n/a")} · cases=${run.evaluationCoverage?.caseCount ?? 0} · positive=${run.evaluationCoverage?.polarities?.positive ?? 0} · negative=${run.evaluationCoverage?.polarities?.negative ?? 0}</small>
      <small>${escapeHtml(run.reviewReportDigest ?? "review report pending")}</small>
      <small>${escapeHtml(run.goal ?? "")}</small>
    `;
    elements.evolutionList.append(item);
  }
  if (evolutions.length === 0) elements.evolutionList.append(emptyCard("No local evolution runs yet."));
}

function renderSourceTypes(sourceTypes) {
  elements.sourceTypes.innerHTML = "";
  for (const source of sourceTypes) {
    const item = document.createElement("article");
    item.className = "source";
    item.innerHTML = `<strong>${escapeHtml(source.label)}</strong><small>${escapeHtml(source.description)}</small>`;
    elements.sourceTypes.append(item);
  }
}

function updateCommandPreview() {
  const sourceProject = elements.sourceProject.value.trim() || "/path/to/source-project";
  const goal = elements.goal.value.trim() || "Produce or evolve a reusable Harness asset.";
  const workspace = elements.confirmedBy.value.trim() || "$EVOPILOT_HARNESS_HOME";
  elements.commandPreview.textContent = [
    "evopilot-harness produce \\",
    `  --workspace ${quote(workspace)} \\`,
    `  --source-project ${quote(sourceProject)} \\`,
    `  --goal ${quote(goal)} \\`,
    "  --json"
  ].join("\n");
}

function renderGovernance(packs, evaluation, usage) {
  if (!elements.governanceList || !elements.llmUsage) return;
  elements.governanceList.innerHTML = "";
  for (const pack of packs) {
    const item = document.createElement("article");
    item.innerHTML = `<strong>${escapeHtml(pack.kind)} · ${escapeHtml(pack.id)}@${escapeHtml(pack.version)}</strong><small>${escapeHtml(pack.lifecycle)} · ${escapeHtml(pack.digest)}</small>`;
    elements.governanceList.append(item);
  }
  if (!packs.length) elements.governanceList.append(emptyCard("No governance packs found."));
  elements.llmUsage.innerHTML = "";
  const evalItem = document.createElement("article");
  evalItem.innerHTML = `<strong>Evaluation Packs · ${evaluation.packCount ?? 0}</strong><small>ready=${evaluation.readyCount ?? 0} insufficient=${evaluation.insufficientCount ?? 0} positive=${evaluation.positiveCaseCount ?? 0} negative=${evaluation.negativeCaseCount ?? 0}</small><small>${escapeHtml(JSON.stringify(evaluation.versionCounts ?? {}))}</small>`;
  elements.llmUsage.append(evalItem);
  const usageItem = document.createElement("article");
  usageItem.innerHTML = `<strong>GLM Runs · ${usage.runCount ?? 0}</strong><small>advisor=${usage.advisorRunCount ?? usage.runCount ?? 0} proposal-review=${usage.reviewRunCount ?? 0} · input=${usage.inputTokens ?? 0} output=${usage.outputTokens ?? 0} total=${usage.totalTokens ?? 0}</small>`;
  elements.llmUsage.append(usageItem);
}

function renderError(error) {
  elements.catalogStatus.textContent = `FAILED · ${error.message}`;
  elements.catalogTable.innerHTML = "";
  elements.catalogTable.append(emptyRow("Hub snapshot could not be loaded."));
}

function row(values, className = "") {
  const item = document.createElement("div");
  item.className = `row ${className}`.trim();
  for (const value of values) {
    const cell = document.createElement("span");
    if (typeof value === "string" && value.startsWith("<span")) cell.innerHTML = value;
    else cell.textContent = String(value ?? "-");
    item.append(cell);
  }
  return item;
}

function emptyRow(text) {
  const item = document.createElement("div");
  item.className = "row";
  item.style.gridTemplateColumns = "1fr";
  item.textContent = text;
  return item;
}

function emptyCard(text) {
  const item = document.createElement("article");
  item.className = "card";
  item.textContent = text;
  return item;
}

function pill(text, attention = false) {
  return `<span class="status ${attention ? "attention" : ""}">${escapeHtml(text)}</span>`;
}

function quote(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}
