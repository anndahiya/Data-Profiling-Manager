from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from database_connectors import find_connection, normalize_secret_prefix, required_credentials, validate_read_only_query


class DatabaseConnectorTests(unittest.TestCase):
    def test_read_only_query_validation(self) -> None:
        self.assertEqual(validate_read_only_query("SELECT * FROM customer;"), "SELECT * FROM customer")
        self.assertTrue(validate_read_only_query("WITH recent AS (SELECT * FROM customer) SELECT * FROM recent").startswith("WITH"))
        with self.assertRaisesRegex(ValueError, "SELECT or WITH"):
            validate_read_only_query("DELETE FROM customer")
        with self.assertRaisesRegex(ValueError, "one statement"):
            validate_read_only_query("SELECT * FROM customer; DROP TABLE customer")

    def test_secret_prefix_and_environment_credentials(self) -> None:
        connection = {"secretPrefix": "customer prod"}
        self.assertEqual(normalize_secret_prefix("customer prod"), "CUSTOMER_PROD")
        with patch.dict(os.environ, {"CUSTOMER_PROD_USER": "reader", "CUSTOMER_PROD_PASSWORD": "secret"}, clear=False):
            self.assertEqual(required_credentials(connection), ("reader", "secret"))
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "CUSTOMER_PROD_USER"):
                required_credentials(connection)

    def test_only_enabled_connection_is_resolved(self) -> None:
        config = {"connections": [{"id": "one", "enabled": True}, {"id": "two", "enabled": False}]}
        self.assertEqual(find_connection(config, "one")["id"], "one")
        with self.assertRaisesRegex(ValueError, "No enabled database connection"):
            find_connection(config, "two")


if __name__ == "__main__":
    unittest.main()
