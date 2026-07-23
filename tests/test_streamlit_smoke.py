import unittest
from unittest.mock import patch

import pandas as pd
from streamlit.testing.v1 import AppTest

from snapshot_manager import add_snapshot, create_snapshot, empty_workspace, upsert_dataset


class StreamlitSmokeTests(unittest.TestCase):
    @staticmethod
    def populated_workspace():
        workspace = empty_workspace()
        upsert_dataset(
            workspace,
            dataset_id="customers",
            dataset_name="Customers",
            source_name="customers.csv",
            owner="Jane Smith",
            description="Customer profiling example",
            tags=["customer", "example"],
        )
        first = create_snapshot(
            pd.DataFrame({"id": [1, 2, 3], "state": ["NC", None, "VA"], "spend": [10.0, 20.0, 100.0]}),
            dataset_id="customers",
            dataset_name="Customers",
            source_name="customers_january.csv",
            owner="Jane Smith",
        )
        second = create_snapshot(
            pd.DataFrame({"id": [1, 2, 3, 4], "state": ["NC", "NC", "VA", None], "spend": [10.0, 20.0, 30.0, 200.0], "segment": ["A", "A", "B", "B"]}),
            dataset_id="customers",
            dataset_name="Customers",
            source_name="customers_february.csv",
            owner="Jane Smith",
        )
        first["profiled_at"] = "2026-01-01T07:00:00+00:00"
        second["profiled_at"] = "2026-02-01T07:00:00+00:00"
        add_snapshot(workspace, first)
        add_snapshot(workspace, second)
        workspace["datasets"][0]["schedule"] = {
            "dataset_id": "customers",
            "dataset": "Customers",
            "source": "https://example.com/customers.csv",
            "recipient_name": "Jane Smith",
            "recipient_email": "jane@example.com",
            "cadence": "Monthly",
            "weekday": "Monday",
            "day_of_month": 1,
            "month": 1,
            "hour_utc": 7,
            "minute": 0,
            "ai_summary": False,
        }
        return workspace

    def test_every_hosted_page_renders_without_exception(self):
        workspace = self.populated_workspace()
        pages = [
            "Dashboard",
            "Datasets",
            "Profile",
            "Report viewer",
            "History",
            "Compare",
            "Trends",
            "Monitor",
            "AI explanation",
            "Scheduling",
            "Plugins",
            "Settings",
        ]
        app = AppTest.from_file("app.py")
        app.session_state["page"] = "Dashboard"
        app.session_state["nav_page"] = "Dashboard"
        app.session_state["current_run_id"] = workspace["runs"][-1]["run_id"]
        with patch("hosted_common.initialize_workspace", return_value=(workspace, None, True)):
            app.run(timeout=30)
            self.assertEqual(len(app.exception), 0, [exception.message for exception in app.exception])
            for page in pages[1:]:
                with self.subTest(page=page):
                    app.radio[0].set_value(page)
                    app.run(timeout=30)
                    self.assertEqual(len(app.exception), 0, [exception.message for exception in app.exception])

    def test_local_app_empty_dashboard_renders(self):
        app = AppTest.from_file("local_app.py")
        with (
            patch("local_common.ensure_dirs", return_value=None),
            patch("local_common.load_registry", return_value=[]),
            patch("local_common.load_history", return_value=[]),
        ):
            app.run(timeout=30)
        self.assertEqual(len(app.exception), 0, [exception.message for exception in app.exception])


if __name__ == "__main__":
    unittest.main()
