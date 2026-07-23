"""Read configured databases through optional local-agent SQLAlchemy drivers."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import pandas as pd


DISALLOWED_SQL = re.compile(r"\b(insert|update|delete|drop|alter|create|truncate|merge|call|execute|grant|revoke|copy|put|remove)\b", re.I)


def normalize_secret_prefix(value: str) -> str:
    cleaned = re.sub(r"[^A-Z0-9]+", "_", value.strip().upper()).strip("_")
    return cleaned or "DPM_DATABASE"


def validate_read_only_query(query: str) -> str:
    stripped = re.sub(r"--.*$", "", query, flags=re.M)
    stripped = re.sub(r"/\*[\s\S]*?\*/", "", stripped).strip()
    if not re.match(r"^(select|with)\b", stripped, flags=re.I):
        raise ValueError("Database query must begin with SELECT or WITH.")
    without_trailing = re.sub(r";\s*$", "", stripped)
    if ";" in without_trailing:
        raise ValueError("Database query must contain only one statement.")
    if DISALLOWED_SQL.search(without_trailing):
        raise ValueError("Database query contains a data-changing or administrative statement.")
    return without_trailing


def load_connector_config(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    parsed = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict) or not isinstance(parsed.get("connections", []), list):
        raise ValueError("connector_config.json must contain a connections array.")
    return parsed


def find_connection(config: dict[str, Any] | None, connection_id: str) -> dict[str, Any]:
    if not config:
        raise FileNotFoundError("connector_config.json is required for database sources.")
    connection = next((item for item in config.get("connections", []) if str(item.get("id")) == connection_id and item.get("enabled", True)), None)
    if not connection:
        raise ValueError(f"No enabled database connection named {connection_id!r} exists in connector_config.json.")
    return connection


def required_credentials(connection: dict[str, Any]) -> tuple[str, str]:
    prefix = normalize_secret_prefix(str(connection.get("secretPrefix") or "DPM_DATABASE"))
    user_name = f"{prefix}_USER"
    password_name = f"{prefix}_PASSWORD"
    user = (os.environ.get(user_name) or "").strip()
    password = os.environ.get(password_name) or ""
    if not user or not password:
        raise RuntimeError(f"Set {user_name} and {password_name} on the local agent or runner.")
    return user, password


def build_sqlalchemy_url(connection: dict[str, Any], user: str, password: str):
    try:
        from sqlalchemy import URL
    except ImportError as exc:
        raise RuntimeError("Database connectors are optional. Install requirements-connectors.txt.") from exc

    provider = str(connection.get("provider") or "")
    host = str(connection.get("host") or "").strip()
    port = int(connection.get("port") or (50000 if provider == "DB2" else 5432))
    database = str(connection.get("database") or "").strip()
    schema = str(connection.get("schema") or "").strip()
    ssl_mode = str(connection.get("sslMode") or "prefer")
    if not host:
        raise ValueError("Database host is required.")

    if provider in {"PostgreSQL", "Supabase"}:
        query = {"sslmode": "require" if provider == "Supabase" else ssl_mode}
        return URL.create("postgresql+psycopg", username=user, password=password, host=host, port=port, database=database, query=query)
    if provider == "DB2":
        return URL.create("db2+ibm_db", username=user, password=password, host=host, port=port, database=database)
    if provider == "Snowflake":
        try:
            from snowflake.sqlalchemy import URL as SnowflakeURL
        except ImportError as exc:
            raise RuntimeError("Snowflake support requires snowflake-sqlalchemy from requirements-connectors.txt.") from exc
        kwargs: dict[str, Any] = {
            "account": str(connection.get("account") or host).strip(),
            "user": user,
            "password": password,
            "database": database,
            "schema": schema or None,
            "warehouse": str(connection.get("warehouse") or "").strip() or None,
            "role": str(connection.get("role") or "").strip() or None,
        }
        return SnowflakeURL(**{key: value for key, value in kwargs.items() if value is not None})
    raise ValueError(f"Unsupported database provider: {provider!r}.")


def read_database_connection(connection: dict[str, Any]) -> pd.DataFrame:
    """Execute one read-only query and return at most maxRows rows."""
    try:
        from sqlalchemy import create_engine, text
    except ImportError as exc:
        raise RuntimeError("Database connectors are optional. Install requirements-connectors.txt.") from exc

    query = validate_read_only_query(str(connection.get("query") or ""))
    max_rows = max(1, min(5_000_000, int(connection.get("maxRows") or 100_000)))
    user, password = required_credentials(connection)
    url = build_sqlalchemy_url(connection, user, password)
    engine = create_engine(url, pool_pre_ping=True)
    chunks: list[pd.DataFrame] = []
    rows_read = 0
    try:
        with engine.connect() as sql_connection:
            for chunk in pd.read_sql_query(text(query), sql_connection, chunksize=min(10_000, max_rows)):
                remaining = max_rows - rows_read
                if remaining <= 0:
                    break
                selected = chunk.iloc[:remaining].copy()
                chunks.append(selected)
                rows_read += len(selected)
                if rows_read >= max_rows:
                    break
    finally:
        engine.dispose()
    if not chunks:
        return pd.DataFrame()
    return pd.concat(chunks, ignore_index=True)


def read_database_source(connection_id: str, config: dict[str, Any] | None) -> tuple[pd.DataFrame, dict[str, Any]]:
    connection = find_connection(config, connection_id)
    frame = read_database_connection(connection)
    return frame, connection
