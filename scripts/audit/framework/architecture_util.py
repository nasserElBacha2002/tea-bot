"""Architecture exception schema and scoped axios usage checks."""

from __future__ import annotations

import re
from typing import Any

from .textutil import mask_non_code

AXIOS_HTTP_RE = re.compile(
    r"\baxios\s*\.\s*(?:get|post|put|patch|delete|head|options|request|all|spread)\s*\(",
    re.I,
)
AXIOS_MEMBER_RE = re.compile(r"\baxios\s*\.\s*([A-Za-z_$][\w$]*)", re.M)

REQUIRED_EXCEPTION_KEYS = ("rule", "file", "reason", "expires_at")


def validate_architecture_config(data: dict[str, Any]) -> list[str]:
    """Return human-readable schema errors (empty when valid)."""
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["audit-architecture.json must be an object"]
    exceptions = data.get("exceptions")
    if exceptions is None:
        return errors
    if not isinstance(exceptions, list):
        return ["exceptions must be an array"]
    for index, entry in enumerate(exceptions):
        if not isinstance(entry, dict):
            errors.append(f"exceptions[{index}] must be an object")
            continue
        for key in REQUIRED_EXCEPTION_KEYS:
            if not entry.get(key):
                errors.append(f"exceptions[{index}] missing required field {key}")
        rule = str(entry.get("rule") or "")
        if rule.endswith("import-axios") and not entry.get("allowed_members"):
            errors.append(f"exceptions[{index}] axios rule requires allowed_members[]")
        pattern = entry.get("file")
        if pattern in (None, "", "*", "**", "**/*"):
            errors.append(f"exceptions[{index}] file must be a specific path or glob, not global")
    return errors


def axios_allowed_usage(text: str, allowed_members: list[str]) -> bool:
    """True when axios is only referenced through allowed static members (e.g. isAxiosError)."""
    allowed = {name for name in allowed_members if name}
    if not allowed:
        return False
    masked = mask_non_code(text)
    if AXIOS_HTTP_RE.search(masked):
        return False
    for match in AXIOS_MEMBER_RE.finditer(masked):
        if match.group(1) not in allowed:
            return False
    return True


def exception_applies(entry: dict[str, Any], rule: str, file: str | None, text: str | None) -> bool:
    """Whether an architecture exception entry may suppress a finding."""
    if entry.get("rule") and entry.get("rule") != rule:
        return False
    rule_name = str(entry.get("rule") or rule)
    if rule_name.endswith("import-axios"):
        members = list(entry.get("allowed_members") or [])
        if not text or not axios_allowed_usage(text, members):
            return False
    return True