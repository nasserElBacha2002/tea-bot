"""Trivy policy: unfixed HIGH/CRITICAL and expired allowlist fail closed."""

from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
POLICY = ROOT / "scripts" / "ci" / "trivy-policy.mjs"


class TrivyPolicyTests(unittest.TestCase):
    def test_new_unfixed_vulnerability_fails(self):
        report = {
            "Results": [
                {
                    "Target": "pkg",
                    "Vulnerabilities": [
                        {
                            "VulnerabilityID": "CVE-2099-0001",
                            "PkgName": "left-pad",
                            "Severity": "HIGH",
                            "Title": "synthetic unfixed",
                            "InstalledVersion": "1.0.0",
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
                ["node", str(POLICY), str(path)],
                check=False,
                capture_output=True,
                text=True,
                cwd=str(ROOT / "scripts" / "ci"),
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn("CVE-2099-0001", result.stderr)

    def test_expired_allowlist_fails_scanner(self):
        with tempfile.TemporaryDirectory() as tmp:
            harness = Path(tmp) / "expired.mjs"
            allow = Path(tmp) / "trivy-allowlist.json"
            allow.write_text(
                json.dumps(
                    [
                        {
                            "id": "CVE-2099-0001",
                            "package": "left-pad",
                            "severity": "high",
                            "review_by": "2000-01-01",
                            "reason": "expired",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            harness.write_text(
                f"""
import {{ loadAllowlist }} from {json.dumps(POLICY.as_posix())};
try {{
  loadAllowlist({json.dumps(tmp)});
  console.error('expected throw');
  process.exit(1);
}} catch (err) {{
  if (!String(err.message).includes('expired')) {{
    console.error(err);
    process.exit(2);
  }}
  process.exit(0);
}}
""",
                encoding="utf-8",
            )
            result = subprocess.run(
                ["node", str(harness)],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)


if __name__ == "__main__":
    unittest.main()
