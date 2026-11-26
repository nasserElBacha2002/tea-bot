#!/usr/bin/env python3
"""Run the Tea Bot quality scanners and write findings, metrics and the gate."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

AUDIT_SCRIPTS = Path(__file__).resolve().parent
if str(AUDIT_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(AUDIT_SCRIPTS))

from framework.baseline import compare_findings, regressable_findings  # noqa: E402
from framework.architecture_util import exception_applies, validate_architecture_config  # noqa: E402
from framework.config import architecture_exception, audit_dir, is_excluded, load_architecture_config, repo_root  # noqa: E402
from framework.gate import evaluate_gate  # noqa: E402
from framework.models import AuditFinding, finding_key  # noqa: E402
from framework.report import render_summary  # noqa: E402
from framework.scan import ingest_tool_metrics, scan_sources  # noqa: E402


def _write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def _apply_exclusions(findings: list[AuditFinding]) -> list[AuditFinding]:
    for finding in findings:
        exclusion, _skip = is_excluded(finding.id, finding.file, finding.subcategory)
        if exclusion:
            finding.status = exclusion.get("status", "accepted-risk")  # type: ignore[assignment]
            finding.blocking = False
            finding.evidence = {**finding.evidence, "exclusion": exclusion.get("reason")}
    return findings


def _apply_architecture_exceptions(findings: list[AuditFinding], texts: dict[str, str]) -> list[AuditFinding]:
    for finding in findings:
        if not finding.evidence.get("never_baseline"):
            continue
        rule = str(finding.evidence.get("rule") or finding.subcategory)
        entry, expired = architecture_exception(rule, finding.file)
        if entry and finding.file and exception_applies(entry, rule, finding.file, texts.get(finding.file)):
            finding.status = "accepted-risk"
            finding.blocking = False
            finding.evidence = {
                **finding.evidence,
                "architecture_exception": entry.get("reason"),
                "expires_at": entry.get("expires_at") or entry.get("expires"),
                "allowed_members": entry.get("allowed_members"),
            }
        elif entry:
            finding.evidence = {
                **finding.evidence,
                "architecture_exception_rejected": "usage outside allowed_members",
            }
        elif expired:
            finding.evidence = {**finding.evidence, "architecture_exception_expired": expired}
    return findings


def _scanner_integrity_ok(metrics: dict[str, Any]) -> bool:
    telemetry = metrics.get("scanner_telemetry") or {}
    sources = telemetry.get("sources") or {}
    if sources.get("failed", 0) > 0:
        return False
    if sources.get("analyzed", 0) < sources.get("discovered", 0):
        return False
    for tool in ("function_metrics", "dead_exports"):
        block = telemetry.get(tool) or {}
        if block.get("ok") is False:
            return False
        if int(block.get("parse_errors") or block.get("read_errors") or 0) > 0:
            return False
    tool_status = metrics.get("tool_status") or {}
    for key in ("functions.error", "dead_exports.error", "architecture.config"):
        if tool_status.get(key):
            return False
    return True


def _dedupe(findings: list[AuditFinding]) -> list[AuditFinding]:
    best: dict[str, AuditFinding] = {}
    for finding in findings:
        key = finding_key(finding)
        prev = best.get(key)
        if prev is None or (finding.severity == "high" and prev.severity != "high"):
            best[key] = finding
    return list(best.values())


def main() -> int:
    parser = argparse.ArgumentParser(description="Tea Bot quality audit")
    parser.add_argument("--run-id", default=os.environ.get("AUDIT_RUN_ID"))
    parser.add_argument("--print-summary", action="store_true")
    args = parser.parse_args()
    run_id = args.run_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    generated_at = datetime.now(timezone.utc).isoformat()
    root = repo_root()
    out = audit_dir()
    raw = out / "raw"
    raw.mkdir(parents=True, exist_ok=True)

    arch_cfg = load_architecture_config()
    schema_errors = validate_architecture_config(arch_cfg)
    findings, metrics, texts = scan_sources(root)
    if schema_errors:
        metrics.setdefault("tool_status", {})["architecture.config"] = "; ".join(schema_errors)
    ingest_tool_metrics(metrics, raw, findings)
    findings = _apply_architecture_exceptions(_apply_exclusions(_dedupe(findings)), texts)
    findings.sort(key=lambda item: (item.category, item.file or "", item.id))

    baseline_findings_path = out / "baseline" / "findings.baseline.json"
    baseline_metrics_path = out / "baseline" / "metrics.baseline.json"
    baseline_diff = None
    metrics_baseline = None
    if baseline_findings_path.is_file():
        payload = json.loads(baseline_findings_path.read_text(encoding="utf-8"))
        baseline_findings = [AuditFinding.from_dict(item) for item in payload.get("findings") or []]
        baseline_diff = compare_findings(regressable_findings(findings), regressable_findings(baseline_findings))
    if baseline_metrics_path.is_file():
        metrics_baseline = json.loads(baseline_metrics_path.read_text(encoding="utf-8"))

    gate = evaluate_gate(
        findings,
        baseline_diff=baseline_diff,
        metrics=metrics,
        metrics_baseline=metrics_baseline,
        regression_only=True,
    )
    runtime = os.environ.get("AUDIT_RUNTIME", "0") == "1"
    runtime_incomplete = os.environ.get("AUDIT_RUNTIME_INCOMPLETE", "0") == "1"
    scanner_ok = _scanner_integrity_ok(metrics)
    framework_status = "ok" if scanner_ok and not schema_errors else "incomplete"
    current = {
        "run_id": run_id,
        "generated_at": generated_at,
        "run_type": "full",
        "completed": framework_status == "ok",
        "framework_status": framework_status,
        "runtime_collected": runtime,
        "runtime_incomplete": runtime_incomplete or not scanner_ok or bool(schema_errors),
    }
    findings_payload = {
        **current,
        "finding_count": len(findings),
        "findings": [item.to_dict() for item in findings],
        "gate": gate,
        "baseline_diff": baseline_diff,
    }
    _write(out / "findings.json", json.dumps(findings_payload, indent=2, ensure_ascii=False) + "\n")
    _write(out / "metrics.json", json.dumps({**current, **metrics}, indent=2, ensure_ascii=False) + "\n")
    _write(out / "current-run.json", json.dumps(current, indent=2) + "\n")
    summary = render_summary(
        findings=findings,
        gate=gate,
        metrics=metrics,
        baseline_diff=baseline_diff,
        run_id=run_id,
        generated_at=generated_at,
    )
    _write(out / "audit-summary.md", summary)
    status = {
        "run_id": run_id,
        "generated_at": generated_at,
        "overall_status": "pass" if gate["passed"] else "findings",
        "blocking_status": "pass" if gate["passed"] else "fail",
        "blocking_count": gate["blocking_count"],
        "max_severity": gate["max_severity"],
        "gate": gate,
    }
    _write(out / "audit-status.json", json.dumps(status, indent=2, ensure_ascii=False) + "\n")
    if args.print_summary:
        print(
            f"findings={len(findings)} gate={'PASS' if gate['passed'] else 'FAIL'} "
            f"blocking={gate['blocking_count']} cycles={metrics['numbers'].get('cycles.count')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
