"""Magic number heuristic. Informative count, not a gate."""

from __future__ import annotations

import re
from collections import Counter

from ..models import AuditFinding
from ..textutil import mask_non_code

NUMBER_RE = re.compile(r"(?<![\w.])(-?\d+(?:\.\d+)?)(?![\w.])")
IGNORED = {0, 1, -1, 2, -2, 10, 100, 1000}


def scan(texts: dict[str, str]) -> tuple[list[AuditFinding], int, list[dict[str, object]]]:
    per_file: Counter[str] = Counter()
    total = 0
    for rel, text in texts.items():
        masked = mask_non_code(text)
        for match in NUMBER_RE.finditer(masked):
            try:
                value = float(match.group(1))
            except ValueError:
                continue
            if value in IGNORED or abs(value) < 10:
                continue
            per_file[rel] += 1
            total += 1
    samples = [{"file": rel, "count": count} for rel, count in per_file.most_common(20)]
    findings: list[AuditFinding] = []
    if total:
        findings.append(
            AuditFinding(
                id="magic-numbers-summary",
                category="readability",
                subcategory="magic-numbers",
                severity="info",
                confidence="low",
                status="suspected",
                title="Números mágicos",
                description=(
                    f"{total} literales numéricos fuera de 0, 1, 2, 10, 100 y 1000. "
                    "Heurística informativa, con falsos positivos en ids y umbrales con nombre."
                ),
                evidence={"count": total, "top_files": samples},
                recommendation="Nombrar el literal cuando el número codifica una regla de negocio.",
                blocking=False,
            )
        )
    return findings, total, samples
