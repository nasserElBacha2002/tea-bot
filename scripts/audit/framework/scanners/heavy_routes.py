"""Routes with heavy logic: more than 350 lines or more than 40 branches."""

from __future__ import annotations

from ..models import AuditFinding
from ..textutil import line_count, stable_id
from .heuristics import classify_layer, route_branch_count


def scan(texts: dict[str, str], *, line_limit: int = 350, branch_limit: int = 40) -> list[AuditFinding]:
    findings: list[AuditFinding] = []
    for rel, text in texts.items():
        if classify_layer(rel) != "routes":
            continue
        lines = line_count(text)
        branches = route_branch_count(text)
        if lines > line_limit or branches > branch_limit:
            findings.append(
                AuditFinding(
                    id=stable_id("route-heavy", rel),
                    category="architecture",
                    subcategory="heavy-route",
                    severity="low",
                    confidence="medium",
                    status="requires-review",
                    title="Ruta con lógica pesada",
                    description=(
                        f"{lines} líneas y {branches} ramas "
                        f"(umbrales {line_limit} líneas o {branch_limit} ramas). No bloquea."
                    ),
                    file=rel,
                    evidence={"lines": lines, "branches": branches},
                    recommendation="Mover la lógica a un service y dejar la ruta en validar y responder.",
                    blocking=False,
                )
            )
    return findings
