"""Hotspots ported from estudiocristi code_smells_scanner (JS/TS shape).

Method length, parameter count and cyclomatic complexity are measured by
``function_metrics.mjs`` (ESLint). This module covers constructor fan-out,
which ESLint's max-params does not distinguish from a long parameter list.
"""

from __future__ import annotations

from typing import Any

from ..models import AuditFinding
from ..textutil import stable_id
from .heuristics import count_constructor_deps


def scan(texts: dict[str, str], thresholds: dict[str, Any]) -> list[AuditFinding]:
    cfg = (thresholds.get("code_smells") or {}).get("ctor_deps") or {"warning": 8, "high": 12}
    warning = int(cfg.get("warning", 8))
    high = int(cfg.get("high", 12))
    findings: list[AuditFinding] = []
    for rel, text in texts.items():
        deps = count_constructor_deps(text)
        if deps < warning:
            continue
        findings.append(
            AuditFinding(
                id=stable_id("ctor", rel),
                category="code-quality",
                subcategory="ctor-deps",
                severity="medium" if deps >= high else "low",
                confidence="medium",
                status="requires-review",
                title=f"Constructor con {deps} dependencias",
                description=f"Fan-out del constructor ≥ {warning} (alto ≥ {high}). No bloquea por sí mismo.",
                file=rel,
                evidence={"constructor_deps": deps, "warning": warning, "high": high},
                recommendation="Revisar si el tipo acumula responsabilidades antes de partirlo.",
                blocking=False,
            )
        )
    return findings
