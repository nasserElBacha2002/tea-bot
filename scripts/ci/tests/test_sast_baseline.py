"""SAST baseline comparator and schema validation."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "ci" / "sast_baseline.py"


def run_baseline(kind: str, report: Path, baseline: Path, *extra: str, env: dict | None = None) -> subprocess.CompletedProcess:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    return subprocess.run(
        [sys.executable, str(SCRIPT), "--kind", kind, "--current", str(report), "--baseline", str(baseline), *extra],
        check=False,
        capture_output=True,
        text=True,
        env=merged,
    )


class SastBaselineTests(unittest.TestCase):
    def test_new_semgrep_error_fails_and_inherited_passes(self):
        current = {
            "results": [
                {
                    "check_id": "tea-eval",
                    "path": "whatsapp-bot/src/app.js",
                    "start": {"line": 4},
                    "extra": {"severity": "ERROR", "message": "eval", "lines": "eval(x)"},
                },
                {
                    "check_id": "tea-warn",
                    "path": "whatsapp-bot/src/app.js",
                    "start": {"line": 8},
                    "extra": {"severity": "WARNING", "message": "ignored"},
                },
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            report = folder / "semgrep.json"
            baseline = folder / "baseline.json"
            report.write_text(json.dumps(current), encoding="utf-8")
            first = run_baseline("semgrep", report, baseline, "--write-baseline", env={"AUDIT_ALLOW_BASELINE_WRITE": "1"})
            self.assertEqual(first.returncode, 0, first.stderr)
            known = json.loads(baseline.read_text(encoding="utf-8"))["fingerprints"]
            self.assertEqual(len(known), 1)
            ok = run_baseline("semgrep", report, baseline)
            self.assertEqual(ok.returncode, 0, ok.stderr)

            # Nueva ocurrencia de la misma regla en el mismo archivo no queda oculta.
            current["results"].append(
                {
                    "check_id": "tea-eval",
                    "path": "whatsapp-bot/src/app.js",
                    "start": {"line": 20},
                    "extra": {"severity": "ERROR", "message": "eval", "lines": "eval(other)"},
                }
            )
            report.write_text(json.dumps(current), encoding="utf-8")
            second = run_baseline("semgrep", report, baseline)
            self.assertEqual(second.returncode, 1, second.stderr)
            self.assertIn("tea-eval", second.stderr)

            fresh = {
                "results": [
                    {
                        "check_id": "tea-new-function",
                        "path": "frontend/src/main.tsx",
                        "start": {"line": 2},
                        "extra": {"severity": "ERROR", "message": "new Function", "lines": "new Function('x')"},
                    }
                ]
            }
            report.write_text(json.dumps(fresh), encoding="utf-8")
            bad = run_baseline("semgrep", report, baseline)
            self.assertEqual(bad.returncode, 1)
            self.assertIn("tea-new-function", bad.stderr)

    def test_invalid_or_incomplete_report_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            baseline = folder / "baseline.json"
            baseline.write_text(json.dumps({"kind": "semgrep", "fingerprints": []}), encoding="utf-8")
            report = folder / "semgrep.json"
            report.write_text("{}", encoding="utf-8")
            missing_results = run_baseline("semgrep", report, baseline)
            self.assertEqual(missing_results.returncode, 2)
            report.write_text("not-json", encoding="utf-8")
            invalid = run_baseline("semgrep", report, baseline)
            self.assertEqual(invalid.returncode, 2)
            report.write_text(json.dumps({"Results": "nope"}), encoding="utf-8")
            bad_trivy = run_baseline("trivy-misconfig", report, baseline)
            self.assertEqual(bad_trivy.returncode, 2)

    def test_missing_baseline_is_scanner_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "hadolint.json"
            report.write_text("[]", encoding="utf-8")
            result = run_baseline("hadolint", report, Path(tmp) / "missing.json")
            self.assertEqual(result.returncode, 2)

    def test_write_baseline_requires_explicit_control(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            report = folder / "hadolint.json"
            baseline = folder / "baseline.json"
            report.write_text("[]", encoding="utf-8")
            blocked = run_baseline("hadolint", report, baseline, "--write-baseline", env={"AUDIT_ALLOW_BASELINE_WRITE": "0"})
            self.assertEqual(blocked.returncode, 2)
            self.assertIn("AUDIT_ALLOW_BASELINE_WRITE", blocked.stderr)


if __name__ == "__main__":
    unittest.main()
