#!/usr/bin/env python3
"""Read-only boundary guard for guided evopilot-harness CLI operation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


SCHEMA = "evopilot-harness-guided-operator-guard/v3"
POLICY_SCHEMA = "evopilot-harness-guided-operator-policy/v1"
POLICY_PATH = Path(__file__).resolve().parent.parent / "references" / "operator-policy.json"


class GuardError(RuntimeError):
    pass


def emit(status: str, **payload: Any) -> None:
    print(json.dumps({"schema": SCHEMA, "status": status, **payload}, ensure_ascii=True, indent=2))


def canonical(value: str | Path) -> Path:
    return Path(value).expanduser().resolve()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_policy() -> dict[str, Any]:
    try:
        raw = POLICY_PATH.read_bytes()
        policy = json.loads(raw.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GuardError(f"Operator Policy cannot be read: {error}") from error

    if policy.get("schema") != POLICY_SCHEMA:
        raise GuardError(f"Unsupported Operator Policy schema: {policy.get('schema')}")

    release = policy.get("release")
    commands = policy.get("allowedCommands")
    required_docs = policy.get("requiredDocumentation")
    if not isinstance(release, dict) or not release.get("packageName"):
        raise GuardError("Operator Policy release.packageName is required")
    if not isinstance(release.get("allowedMajorVersions"), list):
        raise GuardError("Operator Policy release.allowedMajorVersions must be a list")
    if not isinstance(commands, list) or not commands:
        raise GuardError("Operator Policy allowedCommands must be a non-empty list")
    if not isinstance(required_docs, list) or not required_docs:
        raise GuardError("Operator Policy requiredDocumentation must be a non-empty list")

    command_keys: set[tuple[str, str | None]] = set()
    for command in commands:
        if not isinstance(command, dict) or not command.get("family"):
            raise GuardError("Each allowed command must define a family")
        action = command.get("action")
        if action is not None and not isinstance(action, str):
            raise GuardError("Allowed command action must be a string or null")
        key = (command["family"], action)
        if key in command_keys:
            raise GuardError(f"Duplicate allowed command: {key}")
        command_keys.add(key)

    return {
        **policy,
        "_path": str(POLICY_PATH),
        "_digest": sha256_bytes(raw),
    }


def policy_state(policy: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema": policy["schema"],
        "path": policy["_path"],
        "digest": policy["_digest"],
    }


def is_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def overlaps(left: Path, right: Path) -> bool:
    return is_within(left, right) or is_within(right, left)


def run_git(root: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), *args],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


def hash_file(hasher: Any, file_path: Path, relative: str) -> None:
    hasher.update(relative.encode("utf-8", "surrogateescape"))
    hasher.update(b"\0")
    if file_path.is_symlink():
        hasher.update(b"link\0")
        hasher.update(os.readlink(file_path).encode("utf-8", "surrogateescape"))
        return
    hasher.update(b"file\0")
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)


def git_visible_fingerprint(root: Path) -> dict[str, Any]:
    head = run_git(root, "rev-parse", "HEAD")
    status = run_git(root, "status", "--porcelain=v1", "--untracked-files=all")
    files = run_git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    if head is None or status is None or files is None:
        raise GuardError(f"Release root is not a readable Git checkout: {root}")
    hasher = hashlib.sha256()
    file_count = 0
    for relative in sorted(item for item in files.split("\0") if item):
        file_path = root / relative
        if not file_path.exists() and not file_path.is_symlink():
            hasher.update(f"missing:{relative}".encode())
            continue
        hash_file(hasher, file_path, relative)
        file_count += 1
    return {
        "head": head.strip(),
        "status": status,
        "statusDigest": sha256_bytes(status.encode()),
        "visibleFilesDigest": hasher.hexdigest(),
        "visibleFileCount": file_count,
        "clean": not status.strip(),
    }


def evidence_fingerprint(root: Path, skip_directories: set[str]) -> dict[str, Any]:
    if not root.exists() and not root.is_symlink():
        raise GuardError(f"Source or evidence path does not exist: {root}")
    if root.is_file() or root.is_symlink():
        hasher = hashlib.sha256()
        hash_file(hasher, root, root.name)
        return {
            "path": str(root),
            "type": "file",
            "digest": hasher.hexdigest(),
            "fileCount": 1,
        }
    if not root.is_dir():
        raise GuardError(f"Source or evidence path is unsupported: {root}")
    hasher = hashlib.sha256()
    file_count = 0
    for current, directories, files in os.walk(root, followlinks=False):
        directories[:] = sorted(item for item in directories if item not in skip_directories)
        current_path = Path(current)
        for name in sorted(files):
            file_path = current_path / name
            relative = file_path.relative_to(root).as_posix()
            hash_file(hasher, file_path, relative)
            file_count += 1
    return {
        "path": str(root),
        "type": "directory",
        "digest": hasher.hexdigest(),
        "fileCount": file_count,
    }


def release_major(version: Any) -> int:
    if not isinstance(version, str):
        raise GuardError("Release package version is missing")
    match = re.match(r"^v?(\d+)(?:\.|$)", version)
    if not match:
        raise GuardError(f"Release package version is invalid: {version}")
    return int(match.group(1))


def release_metadata(root: Path, policy: dict[str, Any]) -> dict[str, Any]:
    package_file = root / "package.json"
    if not package_file.exists():
        raise GuardError(f"package.json is missing under Release root: {root}")
    package = json.loads(package_file.read_text(encoding="utf-8"))
    expected_name = policy["release"]["packageName"]
    if package.get("name") != expected_name:
        raise GuardError(f"Release package must be {expected_name}, found {package.get('name')}")
    major = release_major(package.get("version"))
    if major not in policy["release"]["allowedMajorVersions"]:
        raise GuardError(f"Release major {major} is outside the Operator Policy")

    required_docs = list(policy["requiredDocumentation"])
    missing_docs = [item for item in required_docs if not (root / item).is_file()]
    if missing_docs:
        raise GuardError(f"Release CLI documentation is incomplete: {', '.join(missing_docs)}")
    return {
        "root": str(root),
        "name": package.get("name"),
        "version": package.get("version"),
        "major": major,
        "documentation": required_docs,
        "git": git_visible_fingerprint(root),
    }


def assert_boundaries(
    release_root: Path,
    workspace: Path,
    sources: list[Path],
    state_file: Path,
    models_file: Path | None = None,
) -> None:
    if overlaps(release_root, workspace):
        raise GuardError("Workspace must not be the Release root, inside it, or its ancestor")
    if not is_within(state_file, workspace):
        raise GuardError("State file must be stored inside the external Workspace")
    for source in sources:
        if overlaps(source, release_root):
            raise GuardError(f"Source must not overlap the evopilot-harness Release: {source}")
        if overlaps(source, workspace):
            raise GuardError(f"Source must not overlap the writable Workspace: {source}")
    if models_file and overlaps(models_file, workspace):
        raise GuardError("Models file must not overlap the writable Workspace")


def preflight(args: argparse.Namespace) -> int:
    policy = load_policy()
    release_root = canonical(args.release_root)
    workspace = canonical(args.workspace)
    sources = [canonical(item) for item in args.source_project]
    if args.source_root:
        sources.append(canonical(args.source_root))
    sources.extend(canonical(item) for item in args.evidence_path)
    models_file = canonical(args.models_file) if args.models_file else None
    state_file = canonical(args.state_file)
    assert_boundaries(release_root, workspace, sources, state_file, models_file)
    metadata = release_metadata(release_root, policy)
    if args.expected_version and metadata["version"] != args.expected_version:
        raise GuardError(
            f"Release version mismatch: expected {args.expected_version}, found {metadata['version']}"
        )
    skip_directories = set(policy.get("sourceSkipDirectories", []))
    source_states = [evidence_fingerprint(item, skip_directories) for item in sources]
    models_state = evidence_fingerprint(models_file, set()) if models_file else None
    workspace.mkdir(parents=True, exist_ok=True)
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state = {
        "schema": SCHEMA,
        "release": metadata,
        "policy": policy_state(policy),
        "workspace": str(workspace),
        "sources": source_states,
        "modelsFile": models_state,
    }
    state_file.write_text(json.dumps(state, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    status = "READY" if metadata["git"]["clean"] else "READY_WITH_EXISTING_CHANGES"
    emit(status, stateFile=str(state_file), **state)
    return 0


def load_state(state_file: Path) -> dict[str, Any]:
    if not state_file.exists():
        raise GuardError(f"Preflight state does not exist: {state_file}")
    state = json.loads(state_file.read_text(encoding="utf-8"))
    if state.get("schema") != SCHEMA:
        raise GuardError(f"Unsupported preflight state schema: {state.get('schema')}")
    return state


def inspect_integrity(state: dict[str, Any], state_file: Path) -> dict[str, Any]:
    policy = load_policy()
    release_root = canonical(state["release"]["root"])
    workspace = canonical(state["workspace"])
    assert_boundaries(
        release_root,
        workspace,
        [canonical(item["path"]) for item in state.get("sources", [])],
        state_file,
        canonical(state["modelsFile"]["path"]) if state.get("modelsFile") else None,
    )
    current_release = release_metadata(release_root, policy)
    release_fields = ["head", "statusDigest", "visibleFilesDigest", "visibleFileCount"]
    release_changes = {
        field: {
            "before": state["release"]["git"].get(field),
            "after": current_release["git"].get(field),
        }
        for field in release_fields
        if state["release"]["git"].get(field) != current_release["git"].get(field)
    }
    policy_unchanged = state.get("policy") == policy_state(policy)
    skip_directories = set(policy.get("sourceSkipDirectories", []))
    source_results = []
    for original in state.get("sources", []):
        current = evidence_fingerprint(canonical(original["path"]), skip_directories)
        source_results.append(
            {
                "path": original["path"],
                "type": original.get("type", current["type"]),
                "unchanged": original["digest"] == current["digest"],
                "beforeDigest": original["digest"],
                "afterDigest": current["digest"],
                "beforeFileCount": original["fileCount"],
                "afterFileCount": current["fileCount"],
            }
        )
    release_unchanged = (
        not release_changes
        and state["release"]["name"] == current_release["name"]
        and state["release"]["version"] == current_release["version"]
    )
    sources_unchanged = all(item["unchanged"] for item in source_results)
    original_models = state.get("modelsFile")
    current_models = evidence_fingerprint(canonical(original_models["path"]), set()) if original_models else None
    models_unchanged = not original_models or (
        original_models["digest"] == current_models["digest"]
        and original_models["fileCount"] == current_models["fileCount"]
    )
    return {
        "releaseUnchanged": release_unchanged,
        "releaseChanges": release_changes,
        "policyUnchanged": policy_unchanged,
        "sourcesUnchanged": sources_unchanged,
        "sources": source_results,
        "modelsFileUnchanged": models_unchanged,
        "modelsFile": {
            "path": original_models["path"],
            "unchanged": models_unchanged,
            "beforeDigest": original_models["digest"],
            "afterDigest": current_models["digest"],
        } if original_models else None,
        "workspace": str(workspace),
    }


def postflight(args: argparse.Namespace) -> int:
    state_file = canonical(args.state_file)
    state = load_state(state_file)
    integrity = inspect_integrity(state, state_file)
    status = (
        "PASSED"
        if integrity["releaseUnchanged"]
        and integrity["policyUnchanged"]
        and integrity["sourcesUnchanged"]
        and integrity["modelsFileUnchanged"]
        else "FAILED"
    )
    emit(status, **integrity)
    return 0 if status == "PASSED" else 2


def option_value(tokens: list[str], name: str) -> str | None:
    for index, token in enumerate(tokens):
        if token == name and index + 1 < len(tokens):
            return tokens[index + 1]
        if token.startswith(name + "="):
            return token.split("=", 1)[1]
    return None


def normalized_cli(tokens: list[str], release_root: Path) -> list[str]:
    if not tokens:
        raise GuardError("No CLI command was supplied after --")
    if tokens[0] != "node" or len(tokens) < 3 or Path(tokens[1]).name != "index.mjs":
        raise GuardError("Only 'node src/index.mjs ...' is allowed")
    script = canonical(tokens[1]) if Path(tokens[1]).is_absolute() else canonical(release_root / tokens[1])
    expected_script = canonical(release_root / "src/index.mjs")
    if script != expected_script:
        raise GuardError(f"CLI script must be the selected Release entrypoint: {expected_script}")
    return tokens[2:]


def command_rule(policy: dict[str, Any], family: str, action: str | None) -> dict[str, Any]:
    for item in policy["allowedCommands"]:
        if item["family"] == family and item.get("action") == action:
            return item
    label = f"{family} {action}".strip()
    raise GuardError(f"CLI command is outside the Operator Policy: {label}")


def command_documentation_evidence(
    release_root: Path,
    documentation: list[str],
    family: str,
    action: str | None,
) -> list[str]:
    phrase = re.escape(family)
    if action:
        phrase += r"\s+" + re.escape(action)
    pattern = re.compile(rf"(?<![A-Za-z0-9_-]){phrase}(?![A-Za-z0-9_-])", re.IGNORECASE)
    evidence = []
    for relative in documentation:
        text = (release_root / relative).read_text(encoding="utf-8")
        if pattern.search(text):
            evidence.append(relative)
    if not evidence:
        label = f"{family} {action}".strip()
        raise GuardError(f"CLI command lacks current Release documentation evidence: {label}")
    return evidence


def validate_command(args: argparse.Namespace) -> int:
    policy = load_policy()
    release_root = canonical(args.release_root)
    workspace = canonical(args.workspace)
    state_file = canonical(args.state_file)
    if overlaps(release_root, workspace):
        raise GuardError("Workspace overlaps the evopilot-harness Release")
    state = load_state(state_file)
    if canonical(state["release"]["root"]) != release_root:
        raise GuardError("Command Release root does not match the preflight state")
    if canonical(state["workspace"]) != workspace:
        raise GuardError("Command Workspace does not match the preflight state")
    integrity = inspect_integrity(state, state_file)
    if (
        not integrity["releaseUnchanged"]
        or not integrity["policyUnchanged"]
        or not integrity["sourcesUnchanged"]
        or not integrity["modelsFileUnchanged"]
    ):
        raise GuardError("Release, Operator Policy, source, or models file integrity changed after preflight")

    tokens = list(args.command)
    if tokens and tokens[0] == "--":
        tokens = tokens[1:]
    for token in tokens:
        if any(marker in token for marker in policy.get("shellMeta", [])):
            raise GuardError(f"Shell composition is forbidden: {token}")

    cli = normalized_cli(tokens, release_root)
    if not cli:
        raise GuardError("CLI family is missing")
    family = cli[0]
    action = None if family == "produce" else (cli[1] if len(cli) > 1 else None)
    rule = command_rule(policy, family, action)
    documentation_evidence = command_documentation_evidence(
        release_root,
        state["release"]["documentation"],
        family,
        action,
    )

    forbidden = sorted(
        flag
        for flag in policy.get("forbiddenFlags", [])
        if option_value(cli, flag) is not None or flag in cli
    )
    if forbidden:
        raise GuardError(f"Forbidden operator flags: {', '.join(forbidden)}")
    configured_workspace = option_value(cli, "--workspace")
    if configured_workspace is None or canonical(configured_workspace) != workspace:
        raise GuardError("Every operator command must bind the reviewed external --workspace")
    if rule.get("jsonRequired", True) and "--json" not in cli:
        raise GuardError("Operator command must request --json")
    configured_models = option_value(cli, "--models-file")
    advisor_mode = (option_value(cli, "--advisor") or "auto").lower()
    models_required = family == "llm" or (family == "produce" and advisor_mode not in {"off", "disabled"})
    reviewed_models = state.get("modelsFile")
    if models_required and not configured_models:
        raise GuardError("This operator command must explicitly bind the reviewed --models-file")
    if configured_models:
        if not reviewed_models:
            raise GuardError("Command models file was not registered during preflight")
        if canonical(configured_models) != canonical(reviewed_models["path"]):
            raise GuardError("Command models file does not match the reviewed preflight configuration")
    for flag in policy.get("workspaceWriteFlags", []):
        value = option_value(cli, flag)
        if value and not is_within(canonical(value), workspace):
            raise GuardError(f"{flag} must remain inside the external Workspace")

    emit(
        "ALLOWED",
        releaseRoot=str(release_root),
        workspace=str(workspace),
        command=tokens,
        cliFamily=family,
        cliAction=action,
        documentationEvidence=documentation_evidence,
        policyDigest=policy["_digest"],
        preflightIntegrity="PASSED",
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    before = subparsers.add_parser("preflight")
    before.add_argument("--release-root", required=True)
    before.add_argument("--workspace", required=True)
    before.add_argument("--state-file", required=True)
    before.add_argument("--expected-version")
    before.add_argument("--source-project", action="append", default=[])
    before.add_argument("--source-root")
    before.add_argument("--evidence-path", action="append", default=[])
    before.add_argument("--models-file")
    before.set_defaults(handler=preflight)

    after = subparsers.add_parser("postflight")
    after.add_argument("--state-file", required=True)
    after.set_defaults(handler=postflight)

    command = subparsers.add_parser("validate-command")
    command.add_argument("--release-root", required=True)
    command.add_argument("--workspace", required=True)
    command.add_argument("--state-file", required=True)
    command.add_argument("command", nargs=argparse.REMAINDER)
    command.set_defaults(handler=validate_command)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.handler(args)
    except (GuardError, json.JSONDecodeError, OSError) as error:
        emit("BLOCKED", error=str(error))
        return 2


if __name__ == "__main__":
    sys.exit(main())
