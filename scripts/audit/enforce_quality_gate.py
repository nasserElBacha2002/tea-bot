#!/usr/bin/env python3
"""Recompute the quality gate and fail only in --strict mode."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

AUDIT_SCRIPTS = Path(__file__).resolve().parent
if str(AUDIT_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(AUDIT_SCRIPTS))

from framework.baseline import compare_findings, regressable_findings  # noqa: E402
from framework.config import audit_dir  # noqa: E402
from framework.gate import evaluate_gate  # noqa: E402
from framework.models import AuditFinding  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Enforce Tea Bot quality gate")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()
    out = audit_dir()
    findings_path = out / "findings.json"
    metrics_path = out / "metrics.json"
    current_path = out / "current-run.json"
    if not findings_path.is_file() or not metrics_path.is_file() or not current_path.is_file():
        print("Quality gate: falta findings.json, metrics.json o current-run.json", file=sys.stderr)
        return 1 if args.strict else 0

    current = json.loads(current_path.read_text(encoding="utf-8"))
    if args.strict:
        if current.get("completed") is not True or current.get("framework_status") != "ok":
            print("Quality gate: corrida incompleta (framework)", file=sys.stderr)
            return 1
        if current.get("runtime_collected") is not True:
            print("Quality gate: corrida incompleta (runtime eslint/tsc/cobertura ausente)", file=sys.stderr)
            return 1
        if current.get("runtime_incomplete") is True or os.environ.get("AUDIT_RUNTIME_INCOMPLETE") == "1":
            print("Quality gate: scanners de runtime incompletos o con error operativo", file=sys.stderr)
            return 1

    payload = json.loads(findings_path.read_text(encoding="utf-8"))
    metrics_payload = json.loads(metrics_path.read_text(encoding="utf-8"))
    findings = [AuditFinding.from_dict(item) for item in payload.get("findings") or []]
    metrics = {
        "numbers": metrics_payload.get("numbers") or {},
        "maps": metrics_payload.get("maps") or {},
        "tool_status": metrics_payload.get("tool_status") or {},
    }
    baseline_findings_path = out / "baseline" / "findings.baseline.json"
    baseline_metrics_path = out / "baseline" / "metrics.baseline.json"
    baseline_diff = None
    metrics_baseline = None
    if baseline_findings_path.is_file():
        data = json.loads(baseline_findings_path.read_text(encoding="utf-8"))
        baseline_loaded = [AuditFinding.from_dict(item) for item in data.get("findings") or []]
        baseline_diff = compare_findings(regressable_findings(findings), regressable_findings(baseline_loaded))
    if baseline_metrics_path.is_file():
        metrics_baseline = json.loads(baseline_metrics_path.read_text(encoding="utf-8"))
    elif args.strict:
        print("Quality gate: falta audit/baseline/metrics.baseline.json", file=sys.stderr)
        return 1

    gate = evaluate_gate(
        findings,
        baseline_diff=baseline_diff,
        metrics=metrics,
        metrics_baseline=metrics_baseline,
        regression_only=True,
    )

    # El exit code de las unitarias se preserva en backend.unit_tests.failed y entra al
    # progressive gate. Una falla nueva (0→1) bloquea aunque la cobertura no baje.
    # La deuda de pruebas ya presente en el baseline (failed=1) no se reabre aquí.
    unit_exit = (metrics.get("tool_status") or {}).get("backend.unit_tests.exit")
    if unit_exit not in (None, 0):
        print(f"- backend unit tests exit: {unit_exit} (métrica backend.unit_tests.failed)")

    print("Quality gate evaluation")
    print(f"- mode: {'strict' if args.strict else 'diagnostic'}")
    print(f"- passed: {gate['passed']}")
    print(f"- blocking_count: {gate['blocking_count']}")
    for item in gate["blockers"]:
        print(f"  - finding {item['severity']} {item['title']} ({item['file']})")
    for item in gate["metric_regressions"]:
        print(f"  - metric {item['priority']} {item['message']}")
    if args.strict and not gate["passed"]:
        print("QUALITY GATE FAILED", file=sys.stderr)
        return 1
    print("Quality gate PASSED" if args.strict else "Diagnostic audit completed (non-blocking)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
