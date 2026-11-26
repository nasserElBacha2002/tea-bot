"""Negative gate scenarios for DIN-552 corrections round 1."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AUDIT = ROOT / "scripts" / "audit"
SAVE = AUDIT / "save_baseline.py"


class Din552NegativeGate(unittest.TestCase):
    def test_fail_count_regression_blocks(self):
        sys.path.insert(0, str(AUDIT))
        from framework.baseline import compare_metrics

        progressive = {
            "numbers_higher_is_worse": {
                "backend.unit_tests.fail_count": {"tolerance": 0, "priority": "P0"},
            },
            "numbers_lower_is_worse": {},
            "maps_higher_is_worse": {},
        }
        regressions = compare_metrics(
            {"numbers": {"backend.unit_tests.fail_count": 29}, "maps": {}},
            {"numbers": {"backend.unit_tests.fail_count": 28}, "maps": {}},
            progressive,
        )
        self.assertTrue(any(item["key"] == "backend.unit_tests.fail_count" for item in regressions))

    def test_cc_peak_map_regression(self):
        sys.path.insert(0, str(AUDIT))
        from framework.baseline import compare_metrics

        progressive = {
            "numbers_higher_is_worse": {},
            "numbers_lower_is_worse": {},
            "maps_higher_is_worse": {
                "functions.cyclomatic_peak": {"tolerance": 0, "only_if_at_least": 25, "priority": "P1"},
            },
        }
        regressions = compare_metrics(
            {"numbers": {}, "maps": {"functions.cyclomatic_peak": {"a.js": 30}}},
            {"numbers": {}, "maps": {"functions.cyclomatic_peak": {"a.js": 26}}},
            progressive,
        )
        self.assertTrue(any("functions.cyclomatic_peak" in item["message"] for item in regressions))


if __name__ == "__main__":
    unittest.main()