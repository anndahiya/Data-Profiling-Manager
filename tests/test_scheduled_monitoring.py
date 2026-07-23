from __future__ import annotations

import unittest

from monthly_profiling_agent import evaluate_thresholds, normalize_row, should_send_email


class ScheduledMonitoringTests(unittest.TestCase):
    def test_normalize_row_preserves_zero_thresholds_and_delivery_mode(self) -> None:
        import pandas as pd

        row = normalize_row(pd.Series({
            "dataset": "Customers",
            "source": "/data/customers.csv",
            "recipient_email": "steward@example.com",
            "delivery_mode": "breach-only",
            "maximum_duplicate_rows": 0,
            "maximum_missing_percent": 0,
            "attach_report": False,
        }))

        self.assertEqual(row["delivery_mode"], "breach-only")
        self.assertEqual(row["maximum_duplicate_rows"], 0)
        self.assertEqual(row["maximum_missing_percent"], 0)
        self.assertFalse(row["attach_report"])

    def test_breach_only_suppresses_healthy_email(self) -> None:
        self.assertFalse(should_send_email("breach-only", []))
        self.assertTrue(should_send_email("breach-only", ["Missing threshold breached"] ))
        self.assertTrue(should_send_email("every-run", []))

    def test_thresholds_include_quality_rules_missing_duplicates_and_row_change(self) -> None:
        row = {
            "source": "/path/not-used.csv",
            "minimum_overall_quality": 95.0,
            "minimum_record_compliance": 90.0,
            "maximum_missing_percent": 5.0,
            "maximum_duplicate_rows": 0,
            "maximum_row_change_percent": 10.0,
            "maximum_freshness_hours": None,
        }
        snapshot = {"overall_missing_percent": 8.0, "duplicate_rows": 2, "rows": 130}
        previous = {"rows": 100}
        quality = {
            "overall_score": 80.0,
            "record_compliance_score": 70.0,
            "rule_results": [{"rule_name": "Customer ID unique", "score": 75.0, "threshold": 100.0}],
        }

        breaches, notes = evaluate_thresholds(row, snapshot, previous, quality)

        self.assertEqual(notes, [])
        self.assertTrue(any("Overall quality" in breach for breach in breaches))
        self.assertTrue(any("Strict record compliance" in breach for breach in breaches))
        self.assertTrue(any("Customer ID unique" in breach for breach in breaches))
        self.assertTrue(any("Missing cells" in breach for breach in breaches))
        self.assertTrue(any("duplicate rows" in breach for breach in breaches))
        self.assertTrue(any("Row count changed" in breach for breach in breaches))

    def test_quality_threshold_requires_exported_governed_rules(self) -> None:
        row = {
            "source": "/path/not-used.csv",
            "minimum_overall_quality": 95.0,
            "minimum_record_compliance": None,
            "maximum_missing_percent": None,
            "maximum_duplicate_rows": None,
            "maximum_row_change_percent": None,
            "maximum_freshness_hours": None,
        }
        with self.assertRaisesRegex(RuntimeError, "quality_config.json"):
            evaluate_thresholds(row, {"rows": 1}, None, None)


if __name__ == "__main__":
    unittest.main()
