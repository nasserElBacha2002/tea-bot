"""Pre-commit forbidden path detection for nested .env files."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "secrets" / "forbidden-staged.sh"


class ForbiddenStagedTests(unittest.TestCase):
    def test_nested_env_local_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            subprocess.run(["git", "init"], cwd=folder, check=True, capture_output=True)
            nested = folder / "whatsapp-bot" / ".env.local"
            nested.parent.mkdir(parents=True)
            nested.write_text("SECRET=1\n", encoding="utf-8")
            subprocess.run(["git", "add", "whatsapp-bot/.env.local"], cwd=folder, check=True, capture_output=True)
            result = subprocess.run(["bash", str(SCRIPT)], cwd=folder, check=False, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn(".env.local", result.stderr)

    def test_env_example_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            subprocess.run(["git", "init"], cwd=folder, check=True, capture_output=True)
            example = folder / "whatsapp-bot" / ".env.example"
            example.parent.mkdir(parents=True)
            example.write_text("DEMO=1\n", encoding="utf-8")
            subprocess.run(["git", "add", "whatsapp-bot/.env.example"], cwd=folder, check=True, capture_output=True)
            result = subprocess.run(["bash", str(SCRIPT)], cwd=folder, check=False, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
