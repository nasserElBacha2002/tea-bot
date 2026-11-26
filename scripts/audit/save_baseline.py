#!/usr/bin/env python3
"""Save the current full quality run as the regression baseline."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

AUDIT_SCRIPTS = Path(__file__).resolve().parent
if str(AUDIT_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(AUDIT_SCRIPTS))

from framework.config import audit_dir  # noqa: E402


REQUIRED_NUMBERS = (
    "duplication.lines",
    "cycles.count",
    "backend.coverage.files_pct",
    "frontend.coverage.files_pct",
    "frontend.eslint.errors",
    "frontend.tsc.errors",
    "backend.checkjs.errors",
    "backend.syntax.errors",
    "backend.coverage.lines_pct",
    "backend.unit_tests.failed",
    "backend.unit_tests.fail_count",
    "exceptions.empty",
    "exceptions.log_only",
    "exceptions.return_default",
    "patches.type_bypass",
    "env.undocumented",
)

REQUIRED_MAPS = (
    "complexity.cyclomatic",
    "architecture.god_score",
    "functions.long",
    "functions.cyclomatic",
    "functions.params",
    "functions.cyclomatic_peak",
)


def main() -> int:
    if os.environ.get("AUDIT_ALLOW_BASELINE_WRITE") != "1":
        print(
            "Baseline NOT saved: set AUDIT_ALLOW_BASELINE_WRITE=1 to modify quality baselines.",
            file=sys.stderr,
        )
        return 1

    out = audit_dir()
    current_path = out / "current-run.json"
    findings_path = out / "findings.json"
    metrics_path = out / "metrics.json"
    if not current_path.is_file():
        print("Baseline NOT saved: falta current-run.json. Corré npm run audit primero.", file=sys.stderr)
        return 1
    current = json.loads(current_path.read_text(encoding="utf-8"))
    if current.get("completed") is not True or current.get("framework_status") != "ok":
        print("Baseline NOT saved: la corrida de calidad no terminó.", file=sys.stderr)
        return 1
    if current.get("runtime_collected") is not True:
        print("Baseline NOT saved: la corrida no incluyó eslint/tsc/checkJs/cobertura (AUDIT_RUNTIME).", file=sys.stderr)
        return 1
    if current.get("runtime_incomplete") is True:
        print("Baseline NOT saved: la corrida tuvo scanners incompletos o con error operativo.", file=sys.stderr)
        return 1

    findings = json.loads(findings_path.read_text(encoding="utf-8"))
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    if findings.get("run_id") != current.get("run_id") or metrics.get("run_id") != current.get("run_id"):
        print("Baseline NOT saved: run_id de findings/metrics no coincide con current-run.", file=sys.stderr)
        return 1
    if findings.get("completed") is not True or metrics.get("completed") is not True:
        print("Baseline NOT saved: findings/metrics no están marcados como completed.", file=sys.stderr)
        return 1

    numbers = metrics.get("numbers") or {}
    missing = [key for key in REQUIRED_NUMBERS if key not in numbers]
    if missing:
        print(f"Baseline NOT saved: métricas incompletas: {', '.join(missing)}", file=sys.stderr)
        return 1
    missing_maps = [key for key in REQUIRED_MAPS if key not in (metrics.get("maps") or {})]
    if missing_maps:
        print(f"Baseline NOT saved: faltan mapas: {', '.join(missing_maps)}", file=sys.stderr)
        return 1

    kept_findings = [
        item
        for item in (findings.get("findings") or [])
        if not (item.get("evidence") or {}).get("never_baseline")
    ]
    baseline = out / "baseline"
    baseline.mkdir(parents=True, exist_ok=True)
    slim_findings = {
        "run_id": findings.get("run_id"),
        "generated_at": findings.get("generated_at"),
        "finding_count": len(kept_findings),
        "findings": kept_findings,
    }
    slim_metrics = {
        "run_id": metrics.get("run_id"),
        "numbers": metrics.get("numbers") or {},
        "maps": metrics.get("maps") or {},
    }
    (baseline / "findings.baseline.json").write_text(
        json.dumps(slim_findings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    (baseline / "metrics.baseline.json").write_text(
        json.dumps(slim_metrics, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Baseline de calidad guardado en {baseline}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
