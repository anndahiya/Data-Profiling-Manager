import unittest

import pandas as pd

from snapshot_manager import (
    add_snapshot,
    compare_runs,
    create_snapshot,
    dataset_runs,
    empty_workspace,
    snapshot_report_bytes,
    trend_frame,
    upsert_dataset,
    workspace_from_json,
    workspace_to_json,
)


class SnapshotManagerTests(unittest.TestCase):
    def setUp(self):
        self.first = pd.DataFrame(
            {
                "customer_id": [1, 2, 3],
                "state": ["NC", None, "VA"],
                "spend": [10.0, 20.0, 100.0],
            }
        )
        self.second = pd.DataFrame(
            {
                "customer_id": [1, 2, 3, 4],
                "state": ["NC", "NC", "VA", None],
                "spend": [10.0, 20.0, 30.0, 200.0],
                "segment": ["A", "A", "B", "B"],
            }
        )

    def test_snapshot_compare_trend_and_round_trip(self):
        data = empty_workspace()
        first_run = create_snapshot(
            self.first,
            dataset_id="customer",
            dataset_name="Customer",
            source_name="customer_jan.csv",
            owner="Jane",
        )
        second_run = create_snapshot(
            self.second,
            dataset_id="customer",
            dataset_name="Customer",
            source_name="customer_feb.csv",
            owner="Jane",
        )
        upsert_dataset(
            data,
            dataset_id="customer",
            dataset_name="Customer",
            source_name="customer_jan.csv",
            owner="Jane",
        )
        add_snapshot(data, first_run)
        add_snapshot(data, second_run)

        comparison = compare_runs(first_run, second_run)
        self.assertEqual(comparison["summary"]["Rows"], 1)
        self.assertEqual(comparison["added_columns"], ["segment"])
        self.assertEqual(len(dataset_runs(data, "customer")), 2)
        self.assertEqual(len(trend_frame(dataset_runs(data, "customer"))), 2)

        restored = workspace_from_json(workspace_to_json(data))
        self.assertEqual(restored["datasets"][0]["name"], "Customer")
        self.assertEqual(len(restored["runs"]), 2)

    def test_saved_snapshot_excludes_raw_sample_values(self):
        run = create_snapshot(
            self.first,
            dataset_id="customer",
            dataset_name="Customer",
            source_name="customer.csv",
        )
        fields = set(run["basic_profile"][0])
        self.assertNotIn("Top Value", fields)
        self.assertNotIn("Min", fields)
        self.assertNotIn("Max", fields)

    def test_snapshot_report_is_valid_xlsx_bytes(self):
        run = create_snapshot(
            self.first,
            dataset_id="customer",
            dataset_name="Customer",
            source_name="customer.csv",
        )
        content = snapshot_report_bytes(run)
        self.assertGreater(len(content), 1000)
        self.assertEqual(content[:2], b"PK")


if __name__ == "__main__":
    unittest.main()
