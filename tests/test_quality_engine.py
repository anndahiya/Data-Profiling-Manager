from __future__ import annotations

import unittest

import pandas as pd

from quality_engine import evaluate_quality


class ScheduledQualityEngineTests(unittest.TestCase):
    def test_weighted_quality_is_separate_from_strict_record_compliance(self) -> None:
        frame = pd.DataFrame([
            {"email": None, "status": "Active"},
            {"email": None, "status": "Active"},
        ])
        config = {
            "dimensions": [
                {"name": "Completeness", "enabled": True, "weight": 1},
                {"name": "Validity", "enabled": True, "weight": 1},
            ],
            "rules": [
                {"id": "required", "datasetId": "customer", "name": "Email required", "dimension": "Completeness", "columnName": "email", "ruleType": "not-null", "enabled": True, "weight": 1, "threshold": 95},
                {"id": "type", "datasetId": "customer", "name": "Status text", "dimension": "Validity", "columnName": "status", "ruleType": "type", "expectedValue": "text", "enabled": True, "weight": 1, "threshold": 95},
            ],
        }

        quality = evaluate_quality(frame, "customer", config)

        self.assertIsNotNone(quality)
        assert quality is not None
        self.assertEqual(quality["overall_score"], 50)
        self.assertEqual(quality["record_compliance_score"], 0)
        self.assertEqual(quality["rules_evaluated"], 2)
        self.assertEqual(quality["evaluation_status"], "governed")
        self.assertTrue(str(quality["configuration_fingerprint"]).startswith("sha256-"))
        self.assertEqual(quality["rule_results"][0]["column_name"], "email")

    def test_custom_dimension_and_range_rule_are_supported(self) -> None:
        frame = pd.DataFrame([{"amount": 10}, {"amount": 200}])
        config = {
            "dimensions": [{"name": "Business fit", "enabled": True, "weight": 2}],
            "rules": [{"id": "range", "datasetId": "orders", "name": "Amount range", "dimension": "Business fit", "columnName": "amount", "ruleType": "range", "expectedValue": "0", "secondaryValue": "100", "enabled": True, "weight": 3, "threshold": 90}],
        }

        quality = evaluate_quality(frame, "orders", config)

        self.assertIsNotNone(quality)
        assert quality is not None
        self.assertEqual(quality["overall_score"], 50)
        self.assertEqual(quality["rule_results"][0]["failing_records"], 1)

    def test_business_tokens_are_not_silently_treated_as_missing(self) -> None:
        frame = pd.DataFrame([{"status": "unknown"}, {"status": "NA"}, {"status": "none"}, {"status": ""}])
        config = {
            "dimensions": [{"name": "Completeness", "enabled": True, "weight": 1}],
            "rules": [{"id": "required", "datasetId": "customer", "name": "Status required", "dimension": "Completeness", "columnName": "status", "ruleType": "not-null", "enabled": True, "weight": 1, "threshold": 95}],
        }
        quality = evaluate_quality(frame, "customer", config)
        self.assertIsNotNone(quality)
        assert quality is not None
        self.assertEqual(quality["rule_results"][0]["passing_records"], 3)
        self.assertEqual(quality["rule_results"][0]["failing_records"], 1)

    def test_returns_none_when_dataset_has_no_governed_rules(self) -> None:
        frame = pd.DataFrame([{"id": 1}])
        config = {"dimensions": [{"name": "Validity", "enabled": True, "weight": 1}], "rules": []}
        self.assertIsNone(evaluate_quality(frame, "sample", config))


if __name__ == "__main__":
    unittest.main()
