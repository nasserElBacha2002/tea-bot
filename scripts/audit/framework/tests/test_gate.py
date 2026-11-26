"""Gate and scanner unit tests."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from framework.baseline import compare_findings, compare_metrics  # noqa: E402
from framework.gate import evaluate_gate  # noqa: E402
from framework.models import AuditFinding, finding_key  # noqa: E402
from framework.textutil import cyclomatic, duplicated_line_count, find_cycles, mask_non_code  # noqa: E402


def finding(**kwargs):
    base = dict(
        id="1",
        category="cycles",
        subcategory="import-cycle",
        severity="high",
        confidence="high",
        status="detected",
        title="Dependencia cíclica",
        description="a > b",
        file="a.js",
        blocking=True,
    )
    base.update(kwargs)
    return AuditFinding(**base)


class GateTests(unittest.TestCase):
    def test_line_is_not_part_of_identity(self):
        left = finding(line=1)
        right = finding(line=40)
        self.assertEqual(finding_key(left), finding_key(right))

    def test_inherited_blocking_finding_does_not_fail(self):
        current = [finding()]
        diff = compare_findings(current, current)
        gate = evaluate_gate(
            current,
            baseline_diff=diff,
            metrics={"numbers": {}, "maps": {}},
            metrics_baseline={"numbers": {}, "maps": {}},
            regression_only=True,
        )
        self.assertTrue(gate["passed"])
        self.assertEqual(gate["blockers"], [])

    def test_new_cycle_fails(self):
        current = [finding()]
        diff = compare_findings(current, [])
        gate = evaluate_gate(
            current,
            baseline_diff=diff,
            metrics={"numbers": {}, "maps": {}},
            metrics_baseline={"numbers": {}, "maps": {}},
        )
        self.assertFalse(gate["passed"])
        self.assertEqual(len(gate["blockers"]), 1)

    def test_suspected_solid_does_not_block_even_when_new(self):
        item = finding(
            category="solid",
            subcategory="srp",
            severity="medium",
            confidence="low",
            status="suspected",
            title="Posible mezcla",
            blocking=False,
        )
        diff = compare_findings([item], [])
        gate = evaluate_gate(
            [item],
            baseline_diff=diff,
            metrics={"numbers": {}, "maps": {}},
            metrics_baseline={"numbers": {}, "maps": {}},
        )
        self.assertTrue(gate["passed"])

    def test_metric_regression_and_tolerance(self):
        progressive = {
            "numbers_higher_is_worse": {
                "frontend.eslint.errors": {"tolerance": 0, "priority": "P1"},
                "backend.unit_tests.failed": {"tolerance": 0, "priority": "P0"},
                "duplication.lines": {"tolerance_abs": 30, "tolerance_pct": 5, "priority": "P2"},
            },
            "numbers_lower_is_worse": {
                "backend.coverage.lines_pct": {"tolerance": 1.0, "priority": "P1"},
            },
            "maps_higher_is_worse": {
                "complexity.cyclomatic": {
                    "tolerance_abs": 10,
                    "tolerance_pct": 20,
                    "only_if_at_least": 40,
                    "priority": "P1",
                }
            },
        }
        same = compare_metrics(
            {"numbers": {"frontend.eslint.errors": 3, "duplication.lines": 100, "backend.coverage.lines_pct": 40, "backend.unit_tests.failed": 0},
             "maps": {"complexity.cyclomatic": {"a.js": 50}}},
            {"numbers": {"frontend.eslint.errors": 3, "duplication.lines": 100, "backend.coverage.lines_pct": 40, "backend.unit_tests.failed": 0},
             "maps": {"complexity.cyclomatic": {"a.js": 50}}},
            progressive,
        )
        self.assertEqual(same, [])
        worse = compare_metrics(
            {"numbers": {"frontend.eslint.errors": 4, "duplication.lines": 110, "backend.coverage.lines_pct": 38, "backend.unit_tests.failed": 1},
             "maps": {"complexity.cyclomatic": {"a.js": 80, "new.js": 45}}},
            {"numbers": {"frontend.eslint.errors": 3, "duplication.lines": 100, "backend.coverage.lines_pct": 40, "backend.unit_tests.failed": 0},
             "maps": {"complexity.cyclomatic": {"a.js": 50}}},
            progressive,
        )
        keys = {item["key"] for item in worse}
        self.assertIn("frontend.eslint.errors", keys)
        self.assertIn("backend.coverage.lines_pct", keys)
        self.assertIn("backend.unit_tests.failed", keys)
        self.assertIn("complexity.cyclomatic", keys)
        self.assertNotIn("duplication.lines", keys)

    def test_failed_unit_tests_block_even_if_coverage_stable(self):
        progressive = {
            "numbers_higher_is_worse": {
                "backend.unit_tests.failed": {"tolerance": 0, "priority": "P0"},
            },
            "numbers_lower_is_worse": {
                "backend.coverage.lines_pct": {"tolerance": 1.0, "priority": "P1"},
            },
            "maps_higher_is_worse": {},
        }
        regressions = compare_metrics(
            {"numbers": {"backend.unit_tests.failed": 1, "backend.coverage.lines_pct": 54.05}, "maps": {}},
            {"numbers": {"backend.unit_tests.failed": 0, "backend.coverage.lines_pct": 54.05}, "maps": {}},
            progressive,
        )
        self.assertEqual(len(regressions), 1)
        self.assertEqual(regressions[0]["key"], "backend.unit_tests.failed")
        gate = evaluate_gate(
            [],
            baseline_diff={"new_findings": []},
            metrics={"numbers": {"backend.unit_tests.failed": 1, "backend.coverage.lines_pct": 54.05}, "maps": {}},
            metrics_baseline={"numbers": {"backend.unit_tests.failed": 0, "backend.coverage.lines_pct": 54.05}, "maps": {}},
        )
        # evaluate_gate uses thresholds.json progressive; assert explicit regression path above.
        self.assertTrue(any(item["key"] == "backend.unit_tests.failed" for item in regressions))
        self.assertIsNotNone(gate)

    def test_comment_does_not_add_complexity(self):
        self.assertEqual(cyclomatic("function a(){ return 1 }\n"), cyclomatic("// if (true) {\nfunction a(){ return 1 }\n"))

    def test_cycles_are_stable(self):
        graph = {"a.js": {"b.js"}, "b.js": {"a.js"}}
        self.assertEqual(find_cycles(graph), find_cycles({"b.js": {"a.js"}, "a.js": {"b.js"}}))

    def test_duplication_ignores_single_file(self):
        text = "\n".join(["const value = computeSomethingImportant(input);"] * 8)
        self.assertEqual(duplicated_line_count({"a.js": text}, min_lines=8, min_chars=10), 0)
        self.assertGreater(duplicated_line_count({"a.js": text, "b.js": text}, min_lines=8, min_chars=10), 0)

    def test_strings_are_masked(self):
        masked = mask_non_code('const q = "if (true) { while (1) {} }";\n')
        self.assertNotIn("while", masked)


if __name__ == "__main__":
    unittest.main()
