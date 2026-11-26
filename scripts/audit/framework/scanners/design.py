"""Run the design scanners and collect gate metrics."""

from __future__ import annotations

from typing import Any

from ..models import AuditFinding
from . import (
    code_smells,
    dead_env,
    exceptions,
    god_class,
    heavy_routes,
    line_length,
    magic_numbers,
    patches,
    solid_grasp,
    sql_boundaries,
)


def scan_design(
    texts: dict[str, str],
    thresholds: dict[str, Any],
) -> tuple[list[AuditFinding], dict[str, Any]]:
    findings: list[AuditFinding] = []
    solid = solid_grasp.scan(texts)
    findings.extend(solid)
    god_findings, god_scores = god_class.scan(texts, thresholds)
    findings.extend(god_findings)
    catch_findings = exceptions.scan(texts)
    findings.extend(catch_findings)
    patch_findings, patch_counts = patches.scan(texts)
    findings.extend(patch_findings)
    env_findings, undocumented = dead_env.scan(texts)
    findings.extend(env_findings)
    findings.extend(sql_boundaries.scan(texts))
    findings.extend(code_smells.scan(texts, thresholds))
    smells = thresholds.get("code_smells") or {}
    findings.extend(
        heavy_routes.scan(
            texts,
            line_limit=int(smells.get("route_lines", 350)),
            branch_limit=int(smells.get("route_branches", 40)),
        )
    )
    line_findings, line_counts, line_samples = line_length.scan(texts)
    findings.extend(line_findings)
    magic_findings, magic_count, magic_samples = magic_numbers.scan(texts)
    findings.extend(magic_findings)

    empty = sum(1 for item in catch_findings if item.subcategory == "exception-empty")
    returned = sum(1 for item in catch_findings if item.subcategory == "exception-return-default")
    logged = sum(1 for item in catch_findings if item.subcategory == "exception-log-only")
    god_samples = [
        {"file": item.file, "score": item.evidence.get("score"), "band": item.evidence.get("band")}
        for item in god_findings
    ]
    numbers = {
        "solid.grasp.count": len(solid),
        "exceptions.empty": empty,
        "exceptions.return_default": returned,
        "exceptions.log_only": logged,
        "exceptions.problematic": empty + returned + logged,
        "patches.type_bypass": int(patch_counts.get("TYPE_BYPASS", 0)),
        "env.undocumented": undocumented,
        "magic.numbers": magic_count,
        "line_length.over_120": int(line_counts.get("warning", 0)),
        "line_length.over_160": int(line_counts.get("high", 0)),
        "line_length.over_200": int(line_counts.get("severe", 0)),
        "routes.heavy": sum(1 for item in findings if item.subcategory == "heavy-route"),
    }
    samples = {
        "god_class": god_samples,
        "line_length": line_samples,
        "magic_numbers": magic_samples,
        "env_undocumented": next(
            (item.evidence.get("vars") for item in env_findings if item.subcategory == "env-undocumented"),
            [],
        ),
    }
    return findings, {
        "numbers": numbers,
        "maps": {"architecture.god_score": god_scores},
        "samples": samples,
        "scanner_telemetry": {
            "design": {
                "discovered": len(texts),
                "analyzed": len(texts),
                "skipped": 0,
                "failed": 0,
            }
        },
    }
