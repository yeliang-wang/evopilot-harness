#!/usr/bin/env python3
"""Self-test the guided operator policy and read-only guard."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any


GUARD = Path(__file__).resolve().parent / "operator_guard.py"
DOCUMENTED_COMMANDS = """\
node src/index.mjs workspace init
node src/index.mjs workspace status
node src/index.mjs asset v3-test
node src/index.mjs asset v3-inspect
node src/index.mjs asset v3-validate
node src/index.mjs registry v3-validate
node src/index.mjs llm v3-models
node src/index.mjs llm v3-doctor
node src/index.mjs produce
node src/index.mjs proposal inspect
node src/index.mjs proposal review
node src/index.mjs proposal review-inspect
node src/index.mjs proposal approve
node src/index.mjs proposal publish
node src/index.mjs catalog v3-validate
node src/index.mjs hub v3-snapshot
node src/index.mjs hub v3-serve
"""
REQUIRED_DOCS = [
    "AGENTS.md",
    "docs/cli/AGENTS.md",
    "docs/cli/quickstart.md",
    "docs/cli/workflows.md",
    "docs/cli/commands.md",
    "docs/guides/how-harness-works.md",
]


def run(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GUARD), *arguments],
        capture_output=True,
        text=True,
    )


def git(root: Path, *arguments: str) -> None:
    subprocess.run(["git", "-C", str(root), *arguments], check=True, capture_output=True)


def output(result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise AssertionError(f"Guard returned non-JSON output: {result.stdout}\n{result.stderr}") from error


def expect(label: str, result: subprocess.CompletedProcess[str], code: int, status: str) -> None:
    payload = output(result)
    if result.returncode != code or payload.get("status") != status:
        raise AssertionError(
            f"{label}: expected code={code} status={status}, "
            f"found code={result.returncode} payload={payload} stderr={result.stderr}"
        )


def create_release(root: Path) -> None:
    (root / "src").mkdir(parents=True)
    (root / "src/index.mjs").write_text("// test entrypoint\n", encoding="utf-8")
    (root / "package.json").write_text(
        json.dumps({"name": "evopilot-harness", "version": "3.2.0"}) + "\n",
        encoding="utf-8",
    )
    for relative in REQUIRED_DOCS:
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# Test documentation\n\n{DOCUMENTED_COMMANDS}", encoding="utf-8")
    git(root, "init", "-q")
    git(root, "config", "user.name", "Skill Self Test")
    git(root, "config", "user.email", "skill-self-test@example.invalid")
    git(root, "add", ".")
    git(root, "commit", "-qm", "test fixture")


def guard_base(release: Path, workspace: Path, state: Path) -> list[str]:
    return [
        "validate-command",
        "--release-root",
        str(release),
        "--workspace",
        str(workspace),
        "--state-file",
        str(state),
        "--",
        "node",
        "src/index.mjs",
    ]


def main() -> int:
    checks: list[str] = []
    with tempfile.TemporaryDirectory(prefix="evopilot-harness-guided-operator.") as temporary:
        root = Path(temporary)
        release = root / "release"
        source = root / "source"
        evidence = root / "production.log"
        models = root / "models.json"
        workspace = root / "workspace"
        release.mkdir()
        source.mkdir()
        (source / "sample.txt").write_text("source evidence\n", encoding="utf-8")
        evidence.write_text("redacted production evidence\n", encoding="utf-8")
        models.write_text('{"models": []}\n', encoding="utf-8")
        create_release(release)
        state = workspace / ".operator/preflight.json"

        preflight = run(
            "preflight",
            "--release-root",
            str(release),
            "--workspace",
            str(workspace),
            "--state-file",
            str(state),
            "--expected-version",
            "3.2.0",
            "--source-project",
            str(source),
            "--evidence-path",
            str(evidence),
            "--models-file",
            str(models),
        )
        expect("preflight", preflight, 0, "READY")
        checks.append("external workspace preflight")

        allowed = run(
            *guard_base(release, workspace, state),
            "produce",
            "--source-project",
            str(source),
            "--goal",
            "test harness",
            "--models-file",
            str(models),
            "--workspace",
            str(workspace),
            "--json",
        )
        expect("documented produce", allowed, 0, "ALLOWED")
        checks.append("documented command and policy intersection")

        review = run(
            *guard_base(release, workspace, state),
            "proposal",
            "review",
            "proposal-1",
            "--models-file",
            str(models),
            "--workspace",
            str(workspace),
            "--json",
        )
        expect("documented proposal review", review, 0, "ALLOWED")
        checks.append("proposal review binds reviewed models file")

        review_without_models = run(
            *guard_base(release, workspace, state),
            "proposal",
            "review",
            "proposal-1",
            "--workspace",
            str(workspace),
            "--json",
        )
        expect("proposal review without models", review_without_models, 2, "BLOCKED")
        checks.append("proposal review without reviewed models file blocked")

        doctor = run(
            *guard_base(release, workspace, state),
            "llm",
            "v3-doctor",
            "--models-file",
            str(models),
            "--workspace",
            str(workspace),
            "--json",
        )
        expect("documented llm doctor", doctor, 0, "ALLOWED")
        checks.append("documented live Advisor diagnostic allowed")

        unreviewed_models = run(
            *guard_base(release, workspace, state),
            "llm",
            "v3-doctor",
            "--models-file",
            str(root / "different-models.json"),
            "--workspace",
            str(workspace),
            "--json",
        )
        expect("unreviewed models file", unreviewed_models, 2, "BLOCKED")
        checks.append("unreviewed models file blocked")

        postflight = run("postflight", "--state-file", str(state))
        expect("postflight", postflight, 0, "PASSED")
        checks.append("unchanged postflight")

        internal_workspace = release / "runtime"
        blocked_boundary = run(
            "preflight",
            "--release-root",
            str(release),
            "--workspace",
            str(internal_workspace),
            "--state-file",
            str(internal_workspace / "state.json"),
            "--source-project",
            str(source),
        )
        expect("release workspace overlap", blocked_boundary, 2, "BLOCKED")
        checks.append("release workspace overlap blocked")

        blocked_command = run(
            *guard_base(release, workspace, state),
            "catalog",
            "v3-publish",
            "--workspace",
            str(workspace),
            "--json",
        )
        expect("unapproved command", blocked_command, 2, "BLOCKED")
        checks.append("command outside policy blocked")

        blocked_automation = run(
            *guard_base(release, workspace, state),
            "proposal",
            "approve",
            "proposal-1",
            "--approve-and-publish",
            "--workspace",
            str(workspace),
            "--json",
        )
        expect("automatic approval", blocked_automation, 2, "BLOCKED")
        checks.append("automatic approve and publish blocked")

        blocked_output = run(
            *guard_base(release, workspace, state),
            "produce",
            "--workspace",
            str(workspace),
            "--models-file",
            str(models),
            "--out",
            str(root / "outside-output"),
            "--json",
        )
        expect("outside output", blocked_output, 2, "BLOCKED")
        checks.append("workspace escape blocked")

        (source / "sample.txt").write_text("changed source\n", encoding="utf-8")
        blocked_source_change = run(
            *guard_base(release, workspace, state),
            "workspace",
            "status",
            "--workspace",
            str(workspace),
            "--json",
        )
        expect("source mutation", blocked_source_change, 2, "BLOCKED")
        checks.append("source mutation blocked")

        (source / "sample.txt").write_text("source evidence\n", encoding="utf-8")
        workspace_evidence = root / "workspace-evidence"
        state_evidence = workspace_evidence / ".operator/preflight.json"
        evidence_preflight = run(
            "preflight",
            "--release-root",
            str(release),
            "--workspace",
            str(workspace_evidence),
            "--state-file",
            str(state_evidence),
            "--source-project",
            str(source),
            "--evidence-path",
            str(evidence),
            "--models-file",
            str(models),
        )
        expect("evidence preflight", evidence_preflight, 0, "READY")
        evidence.write_text("changed production evidence\n", encoding="utf-8")
        blocked_evidence_change = run(
            *guard_base(release, workspace_evidence, state_evidence),
            "workspace",
            "status",
            "--workspace",
            str(workspace_evidence),
            "--json",
        )
        expect("evidence mutation", blocked_evidence_change, 2, "BLOCKED")
        checks.append("attachment and log mutation blocked")

        evidence.write_text("redacted production evidence\n", encoding="utf-8")
        models.write_text('{"models": [{"id": "changed"}]}\n', encoding="utf-8")
        blocked_models_change = run(
            *guard_base(release, workspace_evidence, state_evidence),
            "workspace",
            "status",
            "--workspace",
            str(workspace_evidence),
            "--json",
        )
        expect("models file mutation", blocked_models_change, 2, "BLOCKED")
        checks.append("models file mutation blocked")
        models.write_text('{"models": []}\n', encoding="utf-8")

        workspace_two = root / "workspace-two"
        state_two = workspace_two / ".operator/preflight.json"
        second_preflight = run(
            "preflight",
            "--release-root",
            str(release),
            "--workspace",
            str(workspace_two),
            "--state-file",
            str(state_two),
            "--source-project",
            str(source),
            "--models-file",
            str(models),
        )
        expect("second preflight", second_preflight, 0, "READY")
        (release / "AGENTS.md").write_text(
            (release / "AGENTS.md").read_text(encoding="utf-8") + "\nchanged\n",
            encoding="utf-8",
        )
        blocked_release_change = run(
            *guard_base(release, workspace_two, state_two),
            "workspace",
            "status",
            "--workspace",
            str(workspace_two),
            "--json",
        )
        expect("release mutation", blocked_release_change, 2, "BLOCKED")
        checks.append("release mutation blocked")

    print(
        json.dumps(
            {
                "status": "PASSED",
                "checkCount": len(checks),
                "checks": checks,
            },
            ensure_ascii=True,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
