"""Quality gate: regressions against the baseline, plus explicit blocking findings."""

from __future__ import annotations

from typing import Any

from .baseline import compare_metrics
from .config import load_thresholds
from .models import AuditFinding, SEVERITY_ORDER, finding_key, max_severity


def should_block(finding: AuditFinding, gate_cfg: dict[str, Any] | None = None) -> bool:
    cfg = gate_cfg or load_thresholds().get("gate", {})
    if finding.status in set(cfg.get("ignore_statuses") or []):
        return False
    if finding.status in {"suspected", "requires-review", "accepted-risk", "false-positive"}:
        return bool(finding.blocking)
    if finding.blocking:
        return True
    if finding.severity in set(cfg.get("block_severities") or ["critical"]) and finding.confidence == "high":
        return True
    return False


def evaluate_gate(
    findings: list[AuditFinding],
    *,
    baseline_diff: dict[str, Any] | None,
    metrics: dict[str, Any],
    metrics_baseline: dict[str, Any] | None,
    regression_only: bool = True,
) -> dict[str, Any]:
    cfg = load_thresholds().get("gate", {})
    progressive = load_thresholds().get("progressive") or {}
    candidates = findings
    if regression_only and baseline_diff is not None:
        new_keys = {item["key"] for item in baseline_diff.get("new_findings", [])}
        candidates = [item for item in findings if finding_key(item) in new_keys]

    blockers = [item for item in candidates if should_block(item, cfg)]
    metric_regressions: list[dict[str, Any]] = []
    if regression_only and metrics_baseline is not None:
        metric_regressions = compare_metrics(metrics, metrics_baseline, progressive)
    elif not regression_only and metrics_baseline is not None:
        metric_regressions = compare_metrics(metrics, metrics_baseline, progressive)

    passed = not blockers and not metric_regressions
    return {
        "passed": passed,
        "blocking_count": len(blockers) + len(metric_regressions),
        "max_severity": max_severity([item.severity for item in findings]) if findings else "info",
        "regression_only": regression_only,
        "blockers": [
            {
                "id": item.id,
                "key": finding_key(item),
                "severity": item.severity,
                "confidence": item.confidence,
                "status": item.status,
                "title": item.title,
                "file": item.file,
                "category": item.category,
            }
            for item in blockers
        ],
        "metric_regressions": metric_regressions,
        "policy": {
            "regression_only": regression_only,
            "note": "La deuda de calidad ya presente en el baseline no bloquea. Una métrica peor o un hallazgo blocking nuevo sí.",
        },
    }


def severity_rank(value: str) -> int:
    return SEVERITY_ORDER.index(value) if value in SEVERITY_ORDER else 0
