"""Gitleaks allowlist must use AND conditions for value-specific exceptions."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def _gitleaks_available() -> bool:
    return subprocess.run(["bash", "-lc", "command -v gitleaks"], check=False, capture_output=True).returncode == 0


@unittest.skipUnless(_gitleaks_available(), "gitleaks binary required")
class GitleaksAllowlistTests(unittest.TestCase):
    def test_config_uses_and_without_path_file_exclusions(self):
        config = (ROOT / ".gitleaks.toml").read_text(encoding="utf-8")
        self.assertIn('condition = "AND"', config)
        self.assertIn("targetRules", config)
        # Value-specific blocks must not rely on paths (that would skip the whole file).
        block = config.split("Fixture de nombre", 1)[1]
        self.assertNotIn("paths =", block.split("[[allowlists]]")[0])

    def test_synthetic_secret_in_excepted_file_is_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            target = folder / "whatsapp-bot" / "src" / "services" / "inbound-media.service.test.js"
            target.parent.mkdir(parents=True)
            # Construir el secreto en runtime para que el archivo de test versionado no dispare gitleaks.
            aws_key = "AKIA" + "JGITEAKSTEST0001"
            slack = "xoxb-" + "123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx"
            target.write_text(
                "\n".join(
                    [
                        f"const storageKey = 'abcd1234.jpg';",
                        f"const fakeAwsKey = '{aws_key}';",
                        f"const slack = '{slack}';",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            example = folder / "whatsapp-bot" / ".env.example"
            example.parent.mkdir(parents=True, exist_ok=True)
            demo_hash = "e6cb496be6f8ec1bb9ece061e9d5589919c6d63d1cfde5bc0095f78d657ce29d"
            example.write_text(
                f"TEA_PASSWORD_HASH={demo_hash}\nSYNTH_SLACK={slack}\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [
                    "gitleaks",
                    "detect",
                    "--no-git",
                    "--source",
                    str(folder),
                    "--config",
                    str(ROOT / ".gitleaks.toml"),
                    "--no-banner",
                    "--report-format",
                    "json",
                    "--report-path",
                    str(folder / "report.json"),
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            report = (folder / "report.json").read_text(encoding="utf-8")
            self.assertTrue(report.strip())
            self.assertNotIn("abcd1234.jpg", report)
            self.assertNotIn(demo_hash, report)
            self.assertTrue("xoxb-" in report or "AKIA" in report)


if __name__ == "__main__":
    unittest.main()
