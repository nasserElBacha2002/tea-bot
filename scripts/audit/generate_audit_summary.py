#!/usr/bin/env python3
"""Regenerate audit/audit-summary.md from the last findings and metrics."""

from __future__ import annotations

import json
import sys
from pathlib import Path

AUDIT_SCRIPTS = Path(__file__).resolve().parent
if str(AUDIT_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(AUDIT_SCRIPTS))

from framework.config import audit_dir  # noqa: E402
from framework.models import AuditFinding  # noqa: E402
from framework.report import render_summary  # noqa: E402


def main() -> int:
    out = audit_dir()
    findings_path = out / "findings.json"
    metrics_path = out / "metrics.json"
    if not findings_path.is_file() or not metrics_path.is_file():
        print("No hay findings.json/metrics.json. Corré npm run audit primero.", file=sys.stderr)
        return 1
    payload = json.loads(findings_path.read_text(encoding="utf-8"))
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    summary = render_summary(
        findings=[AuditFinding.from_dict(item) for item in payload.get("findings") or []],
        gate=payload.get("gate") or {},
        metrics=metrics,
        baseline_diff=payload.get("baseline_diff"),
        run_id=str(payload.get("run_id") or ""),
        generated_at=str(payload.get("generated_at") or ""),
    )
    (out / "audit-summary.md").write_text(summary, encoding="utf-8")
    print(out / "audit-summary.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
