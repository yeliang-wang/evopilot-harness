#!/usr/bin/env python3
"""Regression tests for repository-to-installed Skill synchronization."""

from __future__ import annotations

import importlib.util
import pathlib
import tempfile


MODULE_PATH = pathlib.Path(__file__).with_name("sync_installed_skill.py")
SPEC = importlib.util.spec_from_file_location("sync_installed_skill", MODULE_PATH)
assert SPEC and SPEC.loader
SYNC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SYNC)


def main() -> None:
    source = MODULE_PATH.resolve().parents[1]
    with tempfile.TemporaryDirectory() as directory:
        parent = pathlib.Path(directory)
        target = parent / SYNC.SKILL_NAME
        installed = SYNC.install(source, target)
        assert installed["status"] == "PASS"
        assert installed["sourceManifestDigest"] == installed["targetManifestDigest"]
        assert installed["backup"] is None

        drift = target / "references" / "evidence-contract.md"
        drift.write_text(drift.read_text(encoding="utf-8") + "\nlocal drift\n", encoding="utf-8")
        checked = SYNC.compare(source, target)
        assert checked["status"] == "FAIL"
        assert "references/evidence-contract.md" in checked["mismatched"]

        repaired = SYNC.install(source, target)
        assert repaired["status"] == "PASS"
        assert repaired["backup"] is not None
        assert pathlib.Path(repaired["backup"]).is_dir()

    print("installed Skill sync tests: PASS")


if __name__ == "__main__":
    main()
