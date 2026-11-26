"""SQL ownership and template-interpolation risks.

Controllers, routes and middleware owning SQL are findings. Services that call
``query()`` stay informational until DIN-553 (the architecture rule carries
that signal). Interpolation inside a SQL template is always reported.
"""

from __future__ import annotations

import re
from collections import Counter

from ..models import AuditFinding
from ..textutil import mask_non_code, stable_id
from .heuristics import SQL_RE, classify_layer, has_executable_sql, is_sql_owner

INTERP_RE = re.compile(r"\$\{([^}]{1,240})\}")
QUOTED_INTERP_RE = re.compile(r"(?:N)?'\$\{([^}]+)\}'|\"\$\{([^}]+)\}\"|LIKE\s+'%\$\{", re.I)
RUNTIME_EXPR_RE = re.compile(
    r"\b(?:input|req|request|params|body|headers|payload|user|ctx|context)\b"
    r"|\.query\.|\.body\.|\.params\.|\.headers\.|process\.env",
    re.I,
)


def _sql_templates(text: str) -> list[tuple[int, str]]:
    templates: list[tuple[int, str]] = []
    index = 0
    length = len(text)
    while index < length:
        if text[index] != "`":
            index += 1
            continue
        end = index + 1
        while end < length and text[end] != "`":
            if text[end] == "\\" and end + 1 < length:
                end += 2
                continue
            end += 1
        if end >= length:
            break
        chunk = text[index + 1 : end]
        if "${" in chunk and SQL_RE.search(chunk):
            templates.append((index + 1, chunk))
        index = end + 1
    return templates


def scan(texts: dict[str, str]) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    by_layer: Counter[str] = Counter()
    executable_by_layer: Counter[str] = Counter()
    for rel, text in texts.items():
        layer = classify_layer(rel)
        masked = mask_non_code(text)
        if SQL_RE.search(masked) or has_executable_sql(text):
            by_layer[layer] += 1
        if has_executable_sql(text):
            executable_by_layer[layer] += 1
        if not is_sql_owner(rel) and layer in {"controllers", "routes", "middleware"} and has_executable_sql(text):
            findings.append(
                AuditFinding(
                    id=stable_id("sql-layer", rel),
                    category="sql",
                    subcategory="sql-outside-repository",
                    severity="high",
                    confidence="medium",
                    status="detected",
                    title="SQL ejecutable fuera de repositories",
                    description=f"La capa {layer} ejecuta SQL o query().",
                    file=rel,
                    evidence={"layer": layer},
                    recommendation="Mover el acceso a un repository.",
                    blocking=False,
                )
            )
        quoted = 0
        runtime = 0
        unknown = 0
        for _start, chunk in _sql_templates(text):
            for match in INTERP_RE.finditer(chunk):
                expr = match.group(1).strip()
                if QUOTED_INTERP_RE.search("${" + expr + "}") or QUOTED_INTERP_RE.search(chunk):
                    # Count the interpolation once; quoted check is on the whole chunk below.
                    pass
                if RUNTIME_EXPR_RE.search(expr):
                    runtime += 1
                else:
                    unknown += 1
            quoted += len(QUOTED_INTERP_RE.findall(chunk))
        if quoted:
            findings.append(
                AuditFinding(
                    id=stable_id("sql-quoted", rel),
                    category="sql",
                    subcategory="sql-interpolation",
                    severity="high",
                    confidence="medium",
                    status="requires-review",
                    title="Interpolación de SQL entre comillas",
                    description="Un template SQL mete ${} dentro de un literal. Revisar inyección.",
                    file=rel,
                    evidence={"quoted": quoted},
                    recommendation="Usar parámetros bind en lugar de interpolar valores.",
                    blocking=False,
                )
            )
        elif runtime or unknown:
            findings.append(
                AuditFinding(
                    id=stable_id("sql-interp", rel),
                    category="sql",
                    subcategory="sql-interpolation",
                    severity="medium" if runtime else "low",
                    confidence="medium" if runtime else "low",
                    status="requires-review",
                    title="SQL con interpolación dinámica",
                    description="Hay ${} dentro de un template que contiene SQL. Confirmar que el fragmento sea estático.",
                    file=rel,
                    evidence={"runtime": runtime, "other": unknown},
                    recommendation="Dejar en el template solo fragmentos cerrados o listas de parámetros.",
                    blocking=False,
                )
            )
    findings.append(
        AuditFinding(
            id="sql-inventory-summary",
            category="sql",
            subcategory="inventory",
            severity="info",
            confidence="high",
            status="detected",
            title="Presencia de SQL por capa",
            description="Archivos con SQL o query(), agrupados por capa. query() en services es informativo hasta DIN-553.",
            evidence={
                "counts_by_layer": dict(sorted(by_layer.items())),
                "executable_by_layer": dict(sorted(executable_by_layer.items())),
            },
            recommendation="Concentrar el SQL ejecutable en repositories.",
            blocking=False,
        )
    )
    return findings
