"""Profile one configured database connection without using the browser."""
from __future__ import annotations

import argparse
import os
from datetime import datetime
from pathlib import Path

from data_profiler import build_report
from database_connectors import find_connection, load_connector_config, read_database_connection


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("connection", help="Connection ID from connector_config.json")
    parser.add_argument("--config", default=os.environ.get("DPM_CONNECTOR_CONFIG", "connector_config.json"))
    parser.add_argument("--output", help="Output .xlsx path")
    args = parser.parse_args()
    try:
        config = load_connector_config(Path(args.config))
        connection = find_connection(config, args.connection)
        frame = read_database_connection(connection)
        output = args.output or f"{args.connection}_database_profile_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
        build_report(frame, f"connection:{args.connection}", output)
    except Exception as exc:
        print(f"Database profiling failed: {exc}")
        return 1
    print(f"Profiled {len(frame):,} rows from {connection.get('name', args.connection)}. Report saved to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
