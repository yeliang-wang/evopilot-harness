#!/usr/bin/env python3
"""Atomically synchronize the repository-owned simulator Skill to one reviewed target."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import shutil
import tempfile
from typing import Any


SKILL_NAME = "evopilot-agent-host-production-simulator"
IGNORED_NAMES = {".DS_Store", "__pycache__"}


def sha256(path: pathlib.Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            value.update(chunk)
    return "sha256:" + value.hexdigest()


def manifest(root: pathlib.Path) -> dict[str, str]:
    rows: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part in IGNORED_NAMES for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError(f"symlink is not allowed in governed Skill tree: {relative}")
        if path.is_file():
            rows[relative.as_posix()] = sha256(path)
    return rows


def manifest_digest(value: dict[str, str]) -> str:
    rendered = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(rendered.encode("utf-8")).hexdigest()


def compare(source: pathlib.Path, target: pathlib.Path) -> dict[str, Any]:
    source_manifest = manifest(source)
    target_manifest = manifest(target) if target.is_dir() else {}
    source_names = set(source_manifest)
    target_names = set(target_manifest)
    mismatched = sorted(name for name in source_names & target_names if source_manifest[name] != target_manifest[name])
    result = {
        "status": "PASS" if source_manifest == target_manifest else "FAIL",
        "source": str(source),
        "target": str(target),
        "sourceManifestDigest": manifest_digest(source_manifest),
        "targetManifestDigest": manifest_digest(target_manifest),
        "missing": sorted(source_names - target_names),
        "extra": sorted(target_names - source_names),
        "mismatched": mismatched,
    }
    return result


def validate_target(source: pathlib.Path, target: pathlib.Path) -> None:
    if target.name != SKILL_NAME:
        raise ValueError(f"target basename must be {SKILL_NAME}")
    if target.is_symlink():
        raise ValueError("target Skill must not be a symlink")
    if source.resolve() == target.resolve():
        raise ValueError("source and target must differ")
    if not target.parent.is_dir():
        raise ValueError("target parent directory does not exist")


def install(source: pathlib.Path, target: pathlib.Path) -> dict[str, Any]:
    validate_target(source, target)
    staging = pathlib.Path(tempfile.mkdtemp(prefix=f".{SKILL_NAME}.staging-", dir=target.parent))
    backup: pathlib.Path | None = None
    try:
        shutil.copytree(source, staging, dirs_exist_ok=True, copy_function=shutil.copy2)
        staged = compare(source, staging)
        if staged["status"] != "PASS":
            raise ValueError("staged Skill digest mismatch")
        if target.exists():
            stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            backup = target.parent / f".{SKILL_NAME}.backup-{stamp}"
            if backup.exists():
                raise ValueError(f"backup target already exists: {backup}")
            target.rename(backup)
        staging.rename(target)
        result = compare(source, target)
        if result["status"] != "PASS":
            raise ValueError("installed Skill digest mismatch")
        result["backup"] = str(backup) if backup else None
        result["operation"] = "INSTALL"
        return result
    except Exception:
        if target.exists() and backup and backup.exists():
            shutil.rmtree(target)
            backup.rename(target)
        elif not target.exists() and backup and backup.exists():
            backup.rename(target)
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("check", "install"))
    parser.add_argument("--target", required=True, type=pathlib.Path)
    args = parser.parse_args()
    source = pathlib.Path(__file__).resolve().parents[1]
    target = args.target.expanduser().absolute()
    try:
        result = compare(source, target) if args.mode == "check" else install(source, target)
    except Exception as error:
        result = {"status": "FAIL", "operation": args.mode.upper(), "error": str(error)}
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if result.get("status") == "PASS" else 3


if __name__ == "__main__":
    raise SystemExit(main())
