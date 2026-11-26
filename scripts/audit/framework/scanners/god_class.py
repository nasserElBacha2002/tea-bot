"""Multi-signal god class / god service score.

Bands (Tea Bot thresholds): watch 9, medium 14, high 20. The score is a
progressive per-file metric. The finding itself does not block.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..models import AuditFinding
from ..textutil import extract_imports, line_count, stable_id
from .heuristics import (
    branch_count,
    classify_layer,
    count_constructor_deps,
    count_methods,
    external_integrations,
    has_direct_sql,
    infer_domains,
    is_sql_owner,
)


def score_file(rel: str, text: str, thresholds: dict[str, Any]) -> tuple[int, dict[str, Any], str]:
    cfg = thresholds["god_class"]
    loc = line_count(text)
    methods = count_methods(text)
    deps = count_constructor_deps(text)
    imports = extract_imports(text)
    internal_imports = [item for item in imports if item.startswith(".") or item.startswith("@/")]
    infra_imports = [
        item
        for item in imports
        if any(hint in item.lower() for hint in ("twilio", "mssql", "google", "firebase", "axios"))
    ]
    domains = infer_domains(text, rel)
    branches = branch_count(text)
    direct_sql = has_direct_sql(text) and not is_sql_owner(rel)
    externals = external_integrations(text)
    complex_methods = max(0, methods // 4) if branches > cfg.get("branch_proxy", 60) else max(0, branches // 25)

    score = 0
    reasons: list[str] = []

    if loc > cfg["loc_high"]:
        score += 3
        reasons.append(f"LOC>{cfg['loc_high']} (+3)")
    elif loc > cfg["loc_watch"]:
        score += 2
        reasons.append(f"LOC>{cfg['loc_watch']} (+2)")

    if methods > cfg["methods_high"]:
        score += 3
        reasons.append(f"methods>{cfg['methods_high']} (+3)")

    if deps > cfg["deps_high"]:
        score += 3
        reasons.append(f"constructor_deps>{cfg['deps_high']} (+3)")

    if len(internal_imports) > 20:
        score += 2
        reasons.append("internal_imports>20 (+2)")
    elif len(internal_imports) > cfg["imports_high"]:
        score += 2
        reasons.append(f"internal_imports>{cfg['imports_high']} (+2)")

    if branches > 100:
        score += 3
        reasons.append("ramas>100 (+3)")
    elif branches > 60:
        score += 2
        reasons.append("ramas>60 (+2)")

    if direct_sql:
        score += 3
        reasons.append("sql_fuera_de_repository (+3)")

    if externals:
        score += 2
        reasons.append(f"integraciones={','.join(externals[:3])} (+2)")

    if len(domains) >= 4:
        score += 3
        reasons.append(f"dominios={len(domains)} (+3)")
    elif len(domains) >= 3:
        score += 2
        reasons.append(f"dominios={len(domains)} (+2)")

    if complex_methods >= cfg.get("complex_methods_high", 8):
        score += 2
        reasons.append(f"densidad_de_control~{complex_methods} (+2)")

    if score >= cfg["score_high"]:
        band = "CRITICAL" if score >= cfg["score_high"] + 4 else "HIGH"
    elif score >= cfg["score_medium"]:
        band = "MEDIUM"
    elif score >= cfg["score_watch"]:
        band = "WATCH"
    else:
        band = "OK"

    evidence = {
        "loc": loc,
        "methods": methods,
        "constructor_deps": deps,
        "internal_imports": len(internal_imports),
        "infra_imports": len(infra_imports),
        "domains": domains,
        "branches": branches,
        "direct_sql": direct_sql,
        "external_integrations": externals,
        "control_flow_density_proxy": complex_methods,
        "score": score,
        "band": band,
        "reasons": reasons,
    }
    return score, evidence, band


def scan(texts: dict[str, str], thresholds: dict[str, Any]) -> tuple[list[AuditFinding], dict[str, int]]:
    findings: list[AuditFinding] = []
    scores: dict[str, int] = {}
    severity_map = {"WATCH": "low", "MEDIUM": "medium", "HIGH": "high", "CRITICAL": "critical"}
    for rel, text in texts.items():
        if "/services/" not in rel and "/controllers/" not in rel:
            continue
        if classify_layer(rel) == "tests":
            continue
        score, evidence, band = score_file(rel, text, thresholds)
        scores[rel] = score
        if band == "OK":
            continue
        findings.append(
            AuditFinding(
                id=stable_id("god", rel),
                category="architecture",
                subcategory="god-class",
                severity=severity_map[band],  # type: ignore[arg-type]
                confidence="high" if score >= 16 else "medium",
                status="suspected" if band in {"WATCH", "MEDIUM"} else "requires-review",
                title=f"Candidato a god class: {Path(rel).name}",
                description=f"{Path(rel).name} puntúa {score} ({band}). " + "; ".join(evidence["reasons"]),
                file=rel,
                evidence=evidence,
                recommendation="Separar por responsabilidad si el puntaje sube. Es una heurística.",
                blocking=False,
            )
        )
    return findings, scores
