"""SAST baseline comparator."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "ci" / "sast_baseline.py"


class SastBaselineTests(unittest.TestCase):
    def test_new_semgrep_error_fails_and_inherited_passes(self):
        current = {
            "results": [
                {
                    "check_id": "tea-eval",
                    "path": "whatsapp-bot/src/app.js",
                    "start": {"line": 4},
                    "extra": {"severity": "ERROR", "message": "eval"},
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
            baseline.write_text(
                json.dumps({"kind": "semgrep", "fingerprints": ["tea-eval|whatsapp-bot/src/app.js"]}),
                encoding="utf-8",
            )
            ok = subprocess.run(
                [sys.executable, str(SCRIPT), "--kind", "semgrep", "--current", str(report), "--baseline", str(baseline)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(ok.returncode, 0, ok.stderr)
            fresh = {
                "results": [
                    {
                        "check_id": "tea-new-function",
                        "path": "frontend/src/main.tsx",
                        "start": {"line": 2},
                        "extra": {"severity": "ERROR", "message": "new Function"},
                    }
                ]
            }
            report.write_text(json.dumps(fresh), encoding="utf-8")
            bad = subprocess.run(
                [sys.executable, str(SCRIPT), "--kind", "semgrep", "--current", str(report), "--baseline", str(baseline)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(bad.returncode, 1)
            self.assertIn("tea-new-function", bad.stderr)

    def test_missing_baseline_is_scanner_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "hadolint.json"
            report.write_text("[]", encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--kind",
                    "hadolint",
                    "--current",
                    str(report),
                    "--baseline",
                    str(Path(tmp) / "missing.json"),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2)


if __name__ == "__main__":
    unittest.main()
