"""Design-scanner unit tests (no app tree required)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from framework.config import architecture_exception, load_thresholds  # noqa: E402
from framework.gate import evaluate_gate  # noqa: E402
from framework.models import AuditFinding  # noqa: E402
from framework.scan import _architecture_findings  # noqa: E402
from framework.scanners.dead_env import read_names  # noqa: E402
from framework.scanners.exceptions import scan as scan_exceptions  # noqa: E402
from framework.scanners.god_class import score_file  # noqa: E402
from framework.scanners.heuristics import has_direct_sql  # noqa: E402
from framework.scanners.solid_grasp import scan as scan_solid  # noqa: E402


def _methods(count: int) -> str:
    return "\n".join(f"export async function step{index}() {{ return {index}; }}" for index in range(count))


class DesignScannerTests(unittest.TestCase):
    def test_bare_query_call_is_sql(self):
        self.assertTrue(has_direct_sql("const rows = await query('SELECT 1')"))
        self.assertTrue(has_direct_sql("await query(sql, params)"))
        self.assertFalse(has_direct_sql("const value = req.query.id"))

    def test_srp_needs_three_signals_and_ten_methods(self):
        rel = "whatsapp-bot/src/services/conversation-flow-session.service.js"
        weak = scan_solid({rel: _methods(10) + "\nawait query('x')\n"})
        self.assertFalse(any(item.subcategory == "srp" for item in weak))
        strong = scan_solid(
            {
                rel: _methods(10)
                + "\nawait query('x')\nfetch(url)\nauthorize(user)\nconst flow = 1\nconst session = 2\n"
            }
        )
        srp = [item for item in strong if item.subcategory == "srp"]
        self.assertEqual(len(srp), 1)
        self.assertGreaterEqual(srp[0].evidence["responsibility_signals"], 3)
        self.assertFalse(srp[0].blocking)

    def test_query_call_raises_god_score(self):
        rel = "whatsapp-bot/src/services/audit-log.service.js"
        thresholds = load_thresholds()
        base, _, _ = score_file(rel, "export function run(){ return 1 }\n", thresholds)
        scored, evidence, _band = score_file(rel, "export async function run(){ return query('x') }\n", thresholds)
        self.assertGreater(scored, base)
        self.assertTrue(evidence["direct_sql"])

    def test_service_query_import_is_informational(self):
        findings: list[AuditFinding] = []
        _architecture_findings(
            findings,
            "whatsapp-bot/src/services/agent-outbound-send.service.js",
            "import { query, withTransaction } from '../db/index.js'\n",
            load_thresholds(),
        )
        rules = [item for item in findings if item.subcategory == "services-must-not-import-db-query"]
        self.assertEqual(len(rules), 1)
        self.assertFalse(rules[0].blocking)
        self.assertFalse(rules[0].evidence.get("never_baseline"))

    def test_controller_db_import_is_blocking_and_never_baselined(self):
        findings: list[AuditFinding] = []
        _architecture_findings(
            findings,
            "whatsapp-bot/src/controllers/example.controller.js",
            "import { query } from '../db/index.js'\n",
            load_thresholds(),
        )
        rules = [item for item in findings if item.subcategory == "controllers-must-not-import-db"]
        self.assertEqual(len(rules), 1)
        self.assertTrue(rules[0].blocking)
        self.assertTrue(rules[0].evidence.get("never_baseline"))

    def test_component_axios_import_is_blocking(self):
        findings: list[AuditFinding] = []
        _architecture_findings(
            findings,
            "frontend/src/features/demo/components/Widget.tsx",
            "import axios from 'axios'\n",
            load_thresholds(),
        )
        rules = [item for item in findings if item.subcategory == "components-must-not-import-axios"]
        self.assertEqual(len(rules), 1)
        self.assertTrue(rules[0].blocking)

    def test_import_meta_env_is_read(self):
        names = read_names({"frontend/src/a.ts": "const url = import.meta.env.VITE_API_URL\n"})
        self.assertIn("VITE_API_URL", names)
        names = read_names({"whatsapp-bot/src/a.js": "const mode = process.env.FLOW_STORAGE_MODE\n"})
        self.assertIn("FLOW_STORAGE_MODE", names)

    def test_catch_shapes(self):
        text = "\n".join(
            [
                "try { work() } catch (err) { }",
                "try { work() } catch (err) { return null; }",
                "try { work() } catch (err) { console.error(err) }",
            ]
        )
        found = scan_exceptions({"whatsapp-bot/src/services/a.service.js": text})
        kinds = {item.subcategory for item in found}
        self.assertIn("exception-empty", kinds)
        self.assertIn("exception-return-default", kinds)
        self.assertIn("exception-log-only", kinds)

    def test_known_axios_exception_is_active_and_expired_one_is_not(self):
        entry, reason = architecture_exception(
            "components-must-not-import-axios",
            "frontend/src/features/flows/editor/components/HistoryTimeline.tsx",
        )
        self.assertIsNotNone(entry)
        self.assertIsNone(reason)
        missing, _reason = architecture_exception(
            "components-must-not-import-axios",
            "frontend/src/features/demo/components/Widget.tsx",
        )
        self.assertIsNone(missing)

        from framework import config

        original = config.load_architecture_config
        config.load_architecture_config = lambda: {
            "exceptions": [
                {"rule": "routes-must-not-import-db", "file": "a.js", "expires_at": "2000-01-01"}
            ]
        }
        try:
            expired_entry, expired_reason = config.architecture_exception("routes-must-not-import-db", "a.js")
        finally:
            config.load_architecture_config = original
        self.assertIsNone(expired_entry)
        self.assertIn("expired", expired_reason or "")

    def test_never_baseline_layer_rule_blocks_even_when_already_seen(self):
        item = AuditFinding(
            id="layer",
            category="architecture",
            subcategory="controllers-must-not-import-db",
            severity="high",
            confidence="high",
            status="detected",
            title="controllers-must-not-import-db",
            description="import",
            file="whatsapp-bot/src/controllers/a.js",
            evidence={"never_baseline": True, "rule": "controllers-must-not-import-db"},
            blocking=True,
        )
        gate = evaluate_gate(
            [item],
            baseline_diff={"new_findings": [], "resolved_findings": [], "counts": {}},
            metrics={"numbers": {}, "maps": {}},
            metrics_baseline={"numbers": {}, "maps": {}},
        )
        self.assertFalse(gate["passed"])
        self.assertEqual(len(gate["blockers"]), 1)


if __name__ == "__main__":
    unittest.main()
