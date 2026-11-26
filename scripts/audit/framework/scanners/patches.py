"""TODO / FIXME / HACK / LEGACY / FALLBACK markers and type or lint bypasses."""

from __future__ import annotations

import re

from ..models import AuditFinding
from ..textutil import stable_id

PATCH_COMMENT_RE = re.compile(
    r"(?:^|[^\w])(TODO|FIXME|HACK|TEMPORARY|WORKAROUND|HOTFIX|REMOVE LATER|QUICK FIX)(?:[^\w]|$)",
    re.I,
)
PATCH_COMPAT_RE = re.compile(r"(?://|/\*|\*)\s*.*\b(LEGACY|DEPRECATED|COMPAT|FALLBACK)\b", re.I)
TS_BYPASS_RE = re.compile(r"@ts-ignore|@ts-expect-error|eslint-disable|\bas any\b")
FALLBACK_CHAIN = re.compile(r"(?:\?\?\s*[\w.]+){2,}")
DETAIL_CAP = 80


def scan(texts: dict[str, str]) -> tuple[list[AuditFinding], dict[str, int]]:
    findings: list[AuditFinding] = []
    counts: dict[str, int] = {}
    for rel, text in texts.items():
        for index, line in enumerate(text.splitlines(), start=1):
            marker = PATCH_COMMENT_RE.search(line) or PATCH_COMPAT_RE.search(line)
            if marker:
                kind = marker.group(1).upper()
                counts[kind] = counts.get(kind, 0) + 1
                if sum(1 for item in findings if item.category == "patches" and item.subcategory != "summary") < DETAIL_CAP:
                    severity = "medium" if kind in {"HACK", "HOTFIX", "WORKAROUND", "FIXME"} else "low"
                    findings.append(
                        AuditFinding(
                            id=stable_id("patch", rel, str(index), kind),
                            category="patches",
                            subcategory=kind.lower(),
                            severity=severity,  # type: ignore[arg-type]
                            confidence="medium",
                            status="requires-review",
                            title=f"Marcador {kind} ({rel}:{index})",
                            description=line.strip()[:240],
                            file=rel,
                            line=index,
                            evidence={"marker": kind},
                            recommendation="Asignar dueño y vencimiento; sacar el parche cuando sea seguro.",
                            blocking=False,
                        )
                    )
            if TS_BYPASS_RE.search(line):
                counts["TYPE_BYPASS"] = counts.get("TYPE_BYPASS", 0) + 1
                if sum(1 for item in findings if item.category == "patches" and item.subcategory != "summary") < DETAIL_CAP:
                    findings.append(
                        AuditFinding(
                            id=stable_id("bypass", rel, str(index)),
                            category="patches",
                            subcategory="type-bypass",
                            severity="low",
                            confidence="high",
                            status="detected",
                            title=f"Bypass de tipos o lint ({rel}:{index})",
                            description=line.strip()[:240],
                            file=rel,
                            line=index,
                            evidence={"marker": "TYPE_BYPASS"},
                            recommendation="Corregir el tipo antes de suprimir el chequeo.",
                            blocking=False,
                        )
                    )
            if FALLBACK_CHAIN.search(line) and any(word in line.lower() for word in ("legacy", "compat", "old")):
                counts["FALLBACK_CHAIN"] = counts.get("FALLBACK_CHAIN", 0) + 1
    findings.append(
        AuditFinding(
            id="patches-summary",
            category="patches",
            subcategory="summary",
            severity="info",
            confidence="high",
            status="detected",
            title="Resumen de marcadores TODO/FIXME/HACK/LEGACY",
            description="Conteo de marcadores en el árbol de aplicación. El detalle está limitado.",
            evidence={"counts": counts, "detail_cap": DETAIL_CAP},
            recommendation="Priorizar HACK y FIXME. Un TODO no es severidad alta por sí solo.",
            blocking=False,
        )
    )
    return findings, counts
