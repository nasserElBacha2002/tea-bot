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


def load_architecture_config() -> dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "config" / "audit-architecture.json"
    if not path.is_file():
        return {"exceptions": []}
    data = json.loads(path.read_text(encoding="utf-8"))
    from .architecture_util import validate_architecture_config  # local: avoids cycle at import

    errors = validate_architecture_config(data)
    if errors:
        data["_schema_errors"] = errors
    return data


def architecture_exception(rule: str, file: str | None) -> tuple[dict[str, Any] | None, str | None]:
    """Active exception, or a reason when a matching entry is expired or invalid.

    ``expires_at`` is required. An entry without it does not suppress the finding.
    """
    for entry in load_architecture_config().get("exceptions") or []:
        if entry.get("rule") and entry.get("rule") != rule:
            continue
        pattern = entry.get("file")
        if pattern:
            if not file or not (file == pattern or fnmatch(file, pattern) or fnmatch(file, pattern.lstrip("./"))):
                continue
        expires = entry.get("expires_at") or entry.get("expires")
        if not expires:
            return None, "architecture exception missing expires_at"
        try:
            expiry = date.fromisoformat(str(expires))
        except ValueError:
            return None, f"invalid architecture exception expiry {expires}"
        if expiry < date.today():
            return None, f"architecture exception expired {expires}"
        return entry, None
    return None, None


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
