"""Load audit thresholds and exclusions."""

from __future__ import annotations

import json
from datetime import date
from fnmatch import fnmatch
from pathlib import Path
from typing import Any


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def audit_dir() -> Path:
    return repo_root() / "audit"


def load_thresholds() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "config" / "thresholds.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_exclusions() -> list[dict[str, Any]]:
    path = Path(__file__).resolve().parents[1] / "config" / "exclusions.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return list(data.get("exclusions") or [])


def is_excluded(finding_id: str, file: str | None, rule: str) -> tuple[dict[str, Any] | None, str | None]:
    for entry in load_exclusions():
        expires = entry.get("expires")
        if expires:
            try:
                if date.fromisoformat(str(expires)) < date.today():
                    if _entry_matches(entry, finding_id, file, rule):
                        return None, f"exclusion expired {expires}"
                    continue
            except ValueError:
                return None, f"invalid exclusion expiry {expires}"
        if _entry_matches(entry, finding_id, file, rule):
            return entry, None
    return None, None


def _entry_matches(entry: dict[str, Any], finding_id: str, file: str | None, rule: str) -> bool:
    if entry.get("id") and entry["id"] not in {finding_id, rule}:
        return False
    if entry.get("rule") and entry["rule"] != rule:
        return False
    pattern = entry.get("file")
    if pattern:
        if not file or not (fnmatch(file, pattern) or fnmatch(file, pattern.lstrip("./"))):
            return False
    return bool(entry.get("id") or entry.get("rule") or entry.get("file"))
