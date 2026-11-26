"""Normalized audit finding model."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Severity = Literal["critical", "high", "medium", "low", "info"]
Confidence = Literal["high", "medium", "low"]
Status = Literal[
    "detected",
    "suspected",
    "requires-review",
    "confirmed",
    "accepted-risk",
    "false-positive",
]

SEVERITY_VALUES = {"critical", "high", "medium", "low", "info"}
CONFIDENCE_VALUES = {"high", "medium", "low"}
STATUS_VALUES = {
    "detected",
    "suspected",
    "requires-review",
    "confirmed",
    "accepted-risk",
    "false-positive",
}
SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"]


class FindingValidationError(ValueError):
    """Raised when a finding payload is malformed."""


@dataclass
class AuditFinding:
    id: str
    category: str
    subcategory: str
    severity: Severity
    confidence: Confidence
    status: Status
    title: str
    description: str
    file: str | None = None
    line: int | None = None
    evidence: dict[str, Any] = field(default_factory=dict)
    recommendation: str | None = None
    blocking: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "AuditFinding":
        if not isinstance(data, dict):
            raise FindingValidationError("finding must be an object")
        finding_id = data.get("id")
        if not finding_id or not isinstance(finding_id, str):
            raise FindingValidationError("finding.id is required")
        category = data.get("category")
        if not category or not isinstance(category, str):
            raise FindingValidationError(f"finding.category is required for {finding_id}")
        severity = data.get("severity", "info")
        confidence = data.get("confidence", "medium")
        status = data.get("status", "detected")
        if severity not in SEVERITY_VALUES:
            raise FindingValidationError(f"invalid severity '{severity}' for {finding_id}")
        if confidence not in CONFIDENCE_VALUES:
            raise FindingValidationError(f"invalid confidence '{confidence}' for {finding_id}")
        if status not in STATUS_VALUES:
            raise FindingValidationError(f"invalid status '{status}' for {finding_id}")
        line = data.get("line")
        if line is not None and not isinstance(line, int):
            raise FindingValidationError(f"invalid line for {finding_id}")
        return AuditFinding(
            id=finding_id,
            category=category,
            subcategory=str(data.get("subcategory") or ""),
            severity=severity,  # type: ignore[arg-type]
            confidence=confidence,  # type: ignore[arg-type]
            status=status,  # type: ignore[arg-type]
            title=str(data.get("title") or ""),
            description=str(data.get("description") or ""),
            file=data.get("file"),
            line=line,
            evidence=dict(data.get("evidence") or {}),
            recommendation=data.get("recommendation"),
            blocking=bool(data.get("blocking", False)),
        )


def finding_key(finding: AuditFinding) -> str:
    """Stable identity across runs. Line numbers are evidence, not identity."""
    return "|".join(
        [
            finding.category,
            finding.subcategory,
            finding.file or "",
            finding.title,
        ]
    )


def max_severity(values: list[str]) -> str:
    best = "info"
    for value in values:
        if value not in SEVERITY_ORDER:
            continue
        if SEVERITY_ORDER.index(value) > SEVERITY_ORDER.index(best):
            best = value
    return best
