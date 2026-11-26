"""Negative scenarios required by DIN-444 corrections round 1."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAST = ROOT / "scripts" / "ci" / "sast_baseline.py"
TRIVY = ROOT / "scripts" / "ci" / "trivy-policy.mjs"
GATE = ROOT / "scripts" / "audit" / "framework"


class NegativeAuditScenarios(unittest.TestCase):
    def test_invalid_json_report_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "semgrep.json"
            baseline = Path(tmp) / "baseline.json"
            report.write_text("{not-json", encoding="utf-8")
            baseline.write_text(json.dumps({"kind": "semgrep", "fingerprints": []}), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SAST), "--kind", "semgrep", "--current", str(report), "--baseline", str(baseline)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2)

    def test_incomplete_semgrep_report_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "semgrep.json"
            baseline = Path(tmp) / "baseline.json"
            report.write_text(json.dumps({"version": "1.0"}), encoding="utf-8")
            baseline.write_text(json.dumps({"kind": "semgrep", "fingerprints": []}), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SAST), "--kind", "semgrep", "--current", str(report), "--baseline", str(baseline)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2)

    def test_new_occurrence_of_baselined_rule_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "semgrep.json"
            baseline = Path(tmp) / "baseline.json"
            first = {
                "results": [
                    {
                        "check_id": "tea-eval",
                        "path": "a.js",
                        "start": {"line": 1},
                        "extra": {"severity": "ERROR", "message": "eval", "lines": "eval(1)"},
                    }
                ]
            }
            report.write_text(json.dumps(first), encoding="utf-8")
            write = subprocess.run(
                [sys.executable, str(SAST), "--kind", "semgrep", "--current", str(report), "--baseline", str(baseline), "--write-baseline"],
                check=False,
                capture_output=True,
                text=True,
                env={**os.environ, "AUDIT_ALLOW_BASELINE_WRITE": "1"},
            )
            self.assertEqual(write.returncode, 0, write.stderr)
            second = {
                "results": first["results"]
                + [
                    {
                        "check_id": "tea-eval",
                        "path": "a.js",
                        "start": {"line": 9},
                        "extra": {"severity": "ERROR", "message": "eval", "lines": "eval(2)"},
                    }
                ]
            }
            report.write_text(json.dumps(second), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SAST), "--kind", "semgrep", "--current", str(report), "--baseline", str(baseline)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1)

    def test_new_unpatched_vuln_fails(self):
        report = {
            "Results": [
                {
                    "Target": "pkg",
                    "Vulnerabilities": [
                        {
                            "VulnerabilityID": "CVE-2099-4242",
                            "PkgName": "left-pad",
                            "Severity": "CRITICAL",
                            "Title": "unpatched",
                            "FixedVersion": "",
                        }
                    ],
                }
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "trivy.json"
            path.write_text(json.dumps(report), encoding="utf-8")
            result = subprocess.run(
                ["node", str(TRIVY), str(path)],
                check=False,
                capture_output=True,
                text=True,
                cwd=str(ROOT / "scripts" / "ci"),
            )
            self.assertEqual(result.returncode, 1)

    def test_unit_failure_regresses_even_with_stable_coverage(self):
        sys.path.insert(0, str(ROOT / "scripts" / "audit"))
        from framework.baseline import compare_metrics

        progressive = {
            "numbers_higher_is_worse": {"backend.unit_tests.failed": {"tolerance": 0, "priority": "P0"}},
            "numbers_lower_is_worse": {"backend.coverage.lines_pct": {"tolerance": 1.0, "priority": "P1"}},
            "maps_higher_is_worse": {},
        }
        regressions = compare_metrics(
            {"numbers": {"backend.unit_tests.failed": 1, "backend.coverage.lines_pct": 54.05}, "maps": {}},
            {"numbers": {"backend.unit_tests.failed": 0, "backend.coverage.lines_pct": 54.05}, "maps": {}},
            progressive,
        )
        self.assertTrue(any(item["key"] == "backend.unit_tests.failed" for item in regressions))

    def test_inherited_authorized_unit_debt_does_not_regress(self):
        sys.path.insert(0, str(ROOT / "scripts" / "audit"))
        from framework.baseline import compare_metrics

        progressive = {
            "numbers_higher_is_worse": {"backend.unit_tests.failed": {"tolerance": 0, "priority": "P0"}},
            "numbers_lower_is_worse": {},
            "maps_higher_is_worse": {},
        }
        regressions = compare_metrics(
            {"numbers": {"backend.unit_tests.failed": 1}, "maps": {}},
            {"numbers": {"backend.unit_tests.failed": 1}, "maps": {}},
            progressive,
        )
        self.assertEqual(regressions, [])


if __name__ == "__main__":
    unittest.main()
