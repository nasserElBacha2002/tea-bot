"""Line-length readability signals. Informative only (120 / 160 / 200)."""

from __future__ import annotations

import json
from pathlib import Path

from ..models import AuditFinding

DEFAULTS = {"warning": 120, "high": 160, "severe": 200}


def load_line_config() -> dict[str, int]:
    path = Path(__file__).resolve().parents[2] / "config" / "line-length.json"
    if not path.is_file():
        return dict(DEFAULTS)
    payload = json.loads(path.read_text(encoding="utf-8"))
    thresholds = payload.get("audit_thresholds") or {}
    return {
        "warning": int(thresholds.get("warning", DEFAULTS["warning"])),
        "high": int(thresholds.get("high", DEFAULTS["high"])),
        "severe": int(thresholds.get("severe", DEFAULTS["severe"])),
    }


def scan(texts: dict[str, str]) -> tuple[list[AuditFinding], dict[str, int], list[dict[str, object]]]:
    thresholds = load_line_config()
    counts = {"warning": 0, "high": 0, "severe": 0}
    samples: list[dict[str, object]] = []
    for rel, text in texts.items():
        for index, line in enumerate(text.splitlines(), start=1):
            length = len(line.rstrip("\n"))
            if length > thresholds["severe"]:
                band = "severe"
            elif length > thresholds["high"]:
                band = "high"
            elif length > thresholds["warning"]:
                band = "warning"
            else:
                continue
            counts[band] += 1
            if len(samples) < 40:
                samples.append({"file": rel, "line": index, "length": length, "band": band})
    findings: list[AuditFinding] = []
    total = sum(counts.values())
    if total:
        findings.append(
            AuditFinding(
                id="line-length-summary",
                category="readability",
                subcategory="line-length",
                severity="info",
                confidence="high",
                status="detected",
                title="Líneas que superan el largo de lectura",
                description=(
                    f"{counts['warning']} líneas >{thresholds['warning']}, "
                    f"{counts['high']} >{thresholds['high']}, "
                    f"{counts['severe']} >{thresholds['severe']}. Solo informativo."
                ),
                evidence={"counts": counts, "thresholds": thresholds},
                recommendation="Partir la línea cuando el largo dificulte la lectura. No es un formateador.",
                blocking=False,
            )
        )
    return findings, counts, samples
