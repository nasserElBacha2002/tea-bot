"""Spanish per-file audit report."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from .models import AuditFinding, max_severity

PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2}


def priority_for(finding: AuditFinding) -> str:
    if finding.severity == "critical":
        return "P0"
    if finding.severity == "high" or finding.category == "cycles":
        return "P1"
    return "P2"


def render_summary(
    *,
    findings: list[AuditFinding],
    gate: dict[str, Any],
    metrics: dict[str, Any],
    baseline_diff: dict[str, Any] | None,
    run_id: str,
    generated_at: str,
) -> str:
    lines = [
        "# Auditoría de calidad — Tea Bot",
        "",
        f"Run ID: `{run_id}`",
        f"Generado: {generated_at}",
        "",
        "La deuda que ya está en el baseline no bloquea. El gate falla si una métrica empeora o aparece un hallazgo blocking nuevo (ciclos o un límite de arquitectura marcado como blocking).",
        "Los chequeos de seguridad (gitleaks, npm audit, semgrep, trivy, hadolint) corren aparte y sí bloquean.",
        "",
        "## Resumen",
        "",
        f"- Hallazgos de calidad: **{len(findings)}**",
        f"- Gate: **{'PASS' if gate.get('passed') else 'FAIL'}** (bloqueos={gate.get('blocking_count', 0)})",
        "",
        "## Acciones priorizadas",
        "",
    ]
    actions: list[tuple[str, str]] = []
    for item in gate.get("metric_regressions") or []:
        actions.append((item.get("priority") or "P1", item.get("message") or item.get("key")))
    for finding in findings:
        if finding.severity == "info":
            continue
        evidence = ""
        if finding.evidence:
            shown = {key: finding.evidence[key] for key in list(finding.evidence)[:4]}
            evidence = f" Evidencia: `{json.dumps(shown, ensure_ascii=False)}`."
        loc = finding.file or "-"
        actions.append(
            (
                priority_for(finding),
                f"`{loc}` — {finding.title}.{evidence} {finding.recommendation or ''}".strip(),
            )
        )
    for label in ("P0", "P1", "P2"):
        bucket = [text for pri, text in actions if pri == label]
        lines.append(f"### {label}")
        lines.append("")
        if not bucket:
            lines.append("- Sin acciones en este nivel.")
        else:
            for text in bucket[:15]:
                lines.append(f"- {text}")
            if len(bucket) > 15:
                lines.append(f"- … y {len(bucket) - 15} más en `audit/findings.json`.")
        lines.append("")

    lines.extend(["## Métricas", ""])
    for key, value in sorted((metrics.get("numbers") or {}).items()):
        lines.append(f"- `{key}`: {value}")
    lines.append("")

    if baseline_diff:
        counts = baseline_diff.get("counts") or {}
        lines.extend(
            [
                "## Comparación con baseline",
                "",
                f"- Hallazgos previos: {counts.get('previous', 0)}",
                f"- Hallazgos actuales: {counts.get('current', 0)}",
                f"- Nuevos: {counts.get('new', 0)}",
                f"- Resueltos: {counts.get('resolved', 0)}",
                "",
            ]
        )

    lines.extend(["## Por archivo", ""])
    by_file: dict[str, list[AuditFinding]] = defaultdict(list)
    for finding in findings:
        if finding.file:
            by_file[finding.file].append(finding)
    ranked = sorted(
        by_file.items(),
        key=lambda item: (
            -PRIORITY_ORDER.get(min((priority_for(f) for f in item[1]), key=lambda p: PRIORITY_ORDER[p]), 9),
            -len(item[1]),
            item[0],
        ),
    )
    if not ranked:
        lines.append("Sin hallazgos por archivo.")
        lines.append("")
    for rel, items in ranked[:80]:
        lines.append(f"### `{rel}`")
        lines.append("")
        lines.append(f"- Severidad máxima: {max_severity([item.severity for item in items])}")
        for item in items[:8]:
            where = f":{item.line}" if item.line else ""
            lines.append(
                f"- **{priority_for(item)}** [{item.category}/{item.severity}] {item.title}{where}. {item.description}"
            )
        if len(items) > 8:
            lines.append(f"- … {len(items) - 8} hallazgos más en este archivo.")
        lines.append("")
    if len(ranked) > 80:
        lines.append(f"Otros {len(ranked) - 80} archivos están en `audit/findings.json`.")
        lines.append("")

    samples = metrics.get("samples") or {}
    if any(samples.get(name) for name in ("eslint", "tsc", "checkjs", "syntax")):
        lines.extend(["## Evidencia de herramientas", ""])
        for name in ("eslint", "tsc", "checkjs", "syntax"):
            rows = samples.get(name) or []
            if not rows:
                continue
            lines.append(f"### {name}")
            lines.append("")
            for row in rows[:20]:
                lines.append(f"- `{json.dumps(row, ensure_ascii=False)}`")
            lines.append("")
    return "\n".join(lines) + "\n"
