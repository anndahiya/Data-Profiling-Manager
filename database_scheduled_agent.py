"""Run configured database sources through the existing scheduling and alert pipeline."""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import monthly_profiling_agent as scheduled
from database_connectors import find_connection, load_connector_config, read_database_connection
from quality_engine import load_quality_config

CONNECTOR_CONFIG_FILE = Path(os.environ.get("DPM_CONNECTOR_CONFIG", "connector_config.json"))


def select_connections(config: dict[str, Any], args: argparse.Namespace) -> list[dict[str, Any]]:
    connections = [item for item in config.get("connections", []) if item.get("enabled", True)]
    if args.connection:
        return [item for item in connections if str(item.get("id")) == args.connection]
    if args.cron:
        rows = scheduled.load_config()
        ids = {
            str(row.get("source", "")).split(":", 1)[1]
            for row in rows
            if str(row.get("source", "")).startswith("connection:")
            and (row.get("cron") or scheduled.cadence_to_cron(row)) == args.cron
        }
        return [item for item in connections if str(item.get("id")) in ids]
    if args.all:
        return connections
    raise ValueError("Choose --all, --cron, or --connection.")


def schedule_row_for(connection_id: str) -> dict[str, Any]:
    expected = f"connection:{connection_id}"
    row = next((item for item in scheduled.load_config() if str(item.get("source")) == expected), None)
    if not row:
        raise ValueError(f"No monitor row uses source {expected!r} in schedule_config.csv.")
    return row


def rewrite_snapshot_source(run_id: str, source_reference: str, connection_name: str) -> None:
    if not scheduled.HISTORY_FILE.exists():
        return
    updated: list[str] = []
    for line in scheduled.HISTORY_FILE.read_text(encoding="utf-8").splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            updated.append(line)
            continue
        if isinstance(item, dict) and str(item.get("run_id")) == run_id:
            item["source_name"] = source_reference
            item["source_reference"] = source_reference
            item["database_connection"] = connection_name
        updated.append(json.dumps(item, ensure_ascii=False, default=str))
    scheduled.HISTORY_FILE.write_text("\n".join(updated) + "\n", encoding="utf-8")


def process_connection(connection: dict[str, Any], quality_config: dict[str, Any] | None) -> dict[str, Any]:
    connection_id = str(connection.get("id"))
    row = schedule_row_for(connection_id)
    frame = read_database_connection(connection)
    source_reference = f"connection:{connection_id}"
    original_reader = scheduled.read_table
    scheduled.read_table = lambda source: frame.copy() if source == source_reference else original_reader(source)
    try:
        result = scheduled.process(row, quality_config)
    finally:
        scheduled.read_table = original_reader
    result["connection_id"] = connection_id
    result["database_provider"] = connection.get("provider")
    result["database_connection"] = connection.get("name")
    rewrite_snapshot_source(str(result.get("run_id")), source_reference, str(connection.get("name") or connection_id))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Process every enabled configured database connection.")
    parser.add_argument("--cron", help="Process database connections whose monitor cron matches this value.")
    parser.add_argument("--connection", help="Process one connection ID.")
    args = parser.parse_args()
    try:
        connector_config = load_connector_config(CONNECTOR_CONFIG_FILE)
        if not connector_config:
            raise FileNotFoundError("connector_config.json is required.")
        selected = select_connections(connector_config, args)
        quality_config = load_quality_config(scheduled.QUALITY_CONFIG_FILE)
    except Exception as exc:
        print(f"Configuration error: {exc}")
        return 2
    if not selected:
        print("No database connections matched this run.")
        return 0

    failed = False
    for connection in selected:
        connection_id = str(connection.get("id"))
        try:
            find_connection(connector_config, connection_id)
            entry = process_connection(connection, quality_config)
            print(f"{connection.get('name', connection_id)}: {entry['status']}")
        except Exception as exc:
            failed = True
            entry = {
                "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "connection_id": connection_id,
                "dataset": connection.get("datasetId"),
                "status": f"failed: {exc}",
            }
            print(f"{connection.get('name', connection_id)}: FAILED — {exc}")
        scheduled.append_jsonl(scheduled.LOG_FILE, entry)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
