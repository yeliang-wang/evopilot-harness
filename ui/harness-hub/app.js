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
  commandPreview: document.querySelector("#command-preview")
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
  elements.compatibleEvopilot.textContent = catalog.compatibleEvopilot ?? snapshot.project?.compatibleEvopilot ?? "compatible";
  elements.evolutionCount.textContent = String(snapshot.evolutions?.length ?? 0);
  elements.nextAction.textContent = snapshot.nextAction ?? "review";
  elements.catalogPath.textContent = catalog.catalogPath ?? "published/CATALOG.md";
  renderCatalogTable(catalog.entries ?? []);
  renderHarnessCards(snapshot.harnesses ?? []);
  renderEvolutions(snapshot.evolutions ?? []);
  renderSourceTypes(snapshot.sourceTypes ?? []);
  updateCommandPreview();
}

function renderCatalogTable(entries) {
  elements.catalogTable.innerHTML = "";
  elements.catalogTable.append(row(["Harness", "Version", "Domain", "Status", "Asset", "Digest"], "head"));
  for (const entry of entries) {
    elements.catalogTable.append(row([
      entry.name,
      entry.version,
      entry.domain ?? entry.layer ?? "-",
      pill(entry.status ?? "published", entry.status !== "published"),
      entry.assetPath ? `${entry.assetApiVersion ?? "evopilot.dev/v2"} · ${entry.qualityStatus ?? "unchecked"}` : "-",
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
      <small>actions=${harness.contract?.requiredActionCount ?? 0} adapters=${harness.contract?.evidenceAdapterCount ?? 0} blockers=${harness.contract?.releaseBlockerCount ?? 0}</small>
      <pre>${escapeHtml(commands.evolve ?? "evopilot-harness evolve --source-project /path/to/project --goal \"...\" --json")}</pre>
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
      <small>${escapeHtml(run.status)} · ${escapeHtml(run.targetHarnessId ?? "target pending")} · ${escapeHtml(run.nextAction ?? "review")}</small>
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
  const goal = elements.goal.value.trim() || "Create or evolve a reusable Harness definition.";
  const confirmedBy = elements.confirmedBy.value.trim() || "admin@example.com";
  elements.commandPreview.textContent = [
    "evopilot-harness evolve \\",
    `  --source-project ${quote(sourceProject)} \\`,
    `  --goal ${quote(goal)} \\`,
    "  --approve-and-publish \\",
    `  --confirmed-by ${quote(confirmedBy)} \\`,
    "  --confirmation \"Reviewed source coverage, draft diff, validation, and impact.\" \\",
    "  --json"
  ].join("\n");
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
