"""Create, compare, trend, and export deterministic profiling snapshots."""
from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from io import BytesIO
from typing import Any

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from data_profiler import advanced_profile, basic_profile

DATA_VERSION = 1
MAX_RUNS_PER_DATASET = 30
MAX_TOTAL_RUNS = 150
MAX_BROWSER_DATA_BYTES = 4_000_000

HEADER_FILL = PatternFill("solid", fgColor="6C72CB")
TITLE_FILL = PatternFill("solid", fgColor="2D2A6E")
STRIPE_FILL = PatternFill("solid", fgColor="EEF0FB")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=11)
TITLE_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=16)
THIN = Side(style="thin", color="D9D9D9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def empty_workspace() -> dict[str, Any]:
    return {"version": DATA_VERSION, "datasets": [], "runs": [], "updated_at": None}


def clean_id(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-").lower()
    return cleaned or f"dataset-{uuid.uuid4().hex[:8]}"


def _safe(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    return [{str(key): _safe(value) for key, value in row.items()} for row in frame.to_dict(orient="records")]


def create_snapshot(
    df: pd.DataFrame,
    *,
    dataset_id: str,
    dataset_name: str,
    source_name: str,
    owner: str = "",
) -> dict[str, Any]:
    basic = basic_profile(df)[
        ["Column", "Dtype", "Count", "Missing", "Missing %", "Unique", "Unique %", "Top Freq", "Mean", "Std"]
    ]
    advanced = advanced_profile(df)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "run_id": uuid.uuid4().hex,
        "dataset_id": dataset_id,
        "dataset_name": dataset_name,
        "source_name": source_name,
        "owner": owner,
        "profiled_at": now,
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "duplicate_rows": int(df.duplicated().sum()),
        "missing_cells": int(df.isna().sum().sum()),
        "overall_missing_percent": round(float(df.isna().sum().sum() / df.size * 100), 2) if df.size else 0.0,
        "memory_mb": round(float(df.memory_usage(deep=True).sum() / 1_000_000), 2),
        "numeric_columns": int(df.select_dtypes(include=np.number).shape[1]),
        "categorical_columns": int(df.select_dtypes(exclude=np.number).shape[1]),
        "basic_profile": _records(basic),
        "advanced_profile": _records(advanced),
        "schema": {str(column): str(dtype) for column, dtype in df.dtypes.items()},
        "ai_summary": None,
    }


def upsert_dataset(
    workspace: dict[str, Any],
    *,
    dataset_id: str,
    dataset_name: str,
    source_name: str,
    owner: str = "",
) -> None:
    datasets = workspace.setdefault("datasets", [])
    existing = next((item for item in datasets if item.get("id") == dataset_id), None)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = {
        "id": dataset_id,
        "name": dataset_name,
        "source_name": source_name,
        "owner": owner,
        "updated_at": now,
    }
    if existing:
        existing.update(payload)
    else:
        payload["created_at"] = now
        datasets.append(payload)
    datasets.sort(key=lambda item: str(item.get("name", "")).lower())


def add_snapshot(workspace: dict[str, Any], snapshot: dict[str, Any]) -> None:
    runs = workspace.setdefault("runs", [])
    runs.append(snapshot)
    runs.sort(key=lambda item: item.get("profiled_at", ""))
    dataset_id = snapshot.get("dataset_id")
    matching = [run for run in runs if run.get("dataset_id") == dataset_id]
    if len(matching) > MAX_RUNS_PER_DATASET:
        remove_ids = {run["run_id"] for run in matching[:-MAX_RUNS_PER_DATASET]}
        runs[:] = [run for run in runs if run.get("run_id") not in remove_ids]
    if len(runs) > MAX_TOTAL_RUNS:
        runs[:] = runs[-MAX_TOTAL_RUNS:]
    while len(json.dumps(workspace, ensure_ascii=False).encode("utf-8")) > MAX_BROWSER_DATA_BYTES and len(runs) > 1:
        runs.pop(0)
    workspace["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")


def dataset_runs(workspace: dict[str, Any], dataset_id: str) -> list[dict[str, Any]]:
    return sorted(
        [run for run in workspace.get("runs", []) if run.get("dataset_id") == dataset_id],
        key=lambda item: item.get("profiled_at", ""),
    )


def latest_run(workspace: dict[str, Any], dataset_id: str | None = None) -> dict[str, Any] | None:
    runs = workspace.get("runs", [])
    if dataset_id:
        runs = [run for run in runs if run.get("dataset_id") == dataset_id]
    return max(runs, key=lambda item: item.get("profiled_at", ""), default=None)


def find_run(workspace: dict[str, Any], run_id: str | None) -> dict[str, Any] | None:
    if not run_id:
        return None
    return next((run for run in workspace.get("runs", []) if run.get("run_id") == run_id), None)


def compare_runs(older: dict[str, Any], newer: dict[str, Any]) -> dict[str, Any]:
    old_schema = older.get("schema", {})
    new_schema = newer.get("schema", {})
    added = sorted(set(new_schema) - set(old_schema))
    removed = sorted(set(old_schema) - set(new_schema))
    dtype_changes = [
        {"Column": column, "Before": old_schema[column], "After": new_schema[column]}
        for column in sorted(set(old_schema) & set(new_schema))
        if old_schema[column] != new_schema[column]
    ]
    old_basic = {row.get("Column"): row for row in older.get("basic_profile", [])}
    new_basic = {row.get("Column"): row for row in newer.get("basic_profile", [])}
    column_changes: list[dict[str, Any]] = []
    for column in sorted(set(old_basic) & set(new_basic)):
        old_row, new_row = old_basic[column], new_basic[column]
        old_missing = float(old_row.get("Missing %") or 0)
        new_missing = float(new_row.get("Missing %") or 0)
        old_unique = int(old_row.get("Unique") or 0)
        new_unique = int(new_row.get("Unique") or 0)
        if old_missing != new_missing or old_unique != new_unique:
            column_changes.append(
                {
                    "Column": column,
                    "Missing % before": old_missing,
                    "Missing % after": new_missing,
                    "Missing % change": round(new_missing - old_missing, 2),
                    "Unique before": old_unique,
                    "Unique after": new_unique,
                    "Unique change": new_unique - old_unique,
                }
            )
    return {
        "summary": {
            "Rows": newer.get("rows", 0) - older.get("rows", 0),
            "Columns": newer.get("columns", 0) - older.get("columns", 0),
            "Duplicate rows": newer.get("duplicate_rows", 0) - older.get("duplicate_rows", 0),
            "Missing cells": newer.get("missing_cells", 0) - older.get("missing_cells", 0),
            "Overall missing %": round(float(newer.get("overall_missing_percent", 0)) - float(older.get("overall_missing_percent", 0)), 2),
            "Memory MB": round(float(newer.get("memory_mb", 0)) - float(older.get("memory_mb", 0)), 2),
        },
        "added_columns": added,
        "removed_columns": removed,
        "dtype_changes": dtype_changes,
        "column_changes": column_changes,
    }


def trend_frame(runs: list[dict[str, Any]]) -> pd.DataFrame:
    rows = [
        {
            "Profiled at": pd.to_datetime(run.get("profiled_at"), utc=True),
            "Rows": run.get("rows", 0),
            "Columns": run.get("columns", 0),
            "Duplicate rows": run.get("duplicate_rows", 0),
            "Missing cells": run.get("missing_cells", 0),
            "Overall missing %": run.get("overall_missing_percent", 0),
            "Memory MB": run.get("memory_mb", 0),
        }
        for run in runs
    ]
    return pd.DataFrame(rows).sort_values("Profiled at") if rows else pd.DataFrame()


def update_ai_summary(workspace: dict[str, Any], run_id: str, summary: str) -> None:
    run = find_run(workspace, run_id)
    if run:
        run["ai_summary"] = summary
        workspace["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")


def workspace_to_json(workspace: dict[str, Any]) -> str:
    return json.dumps(workspace, ensure_ascii=False, separators=(",", ":"))


def workspace_from_json(value: str) -> dict[str, Any]:
    if not value:
        return empty_workspace()
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError("Backup must be a JSON object.")
    parsed.setdefault("version", DATA_VERSION)
    parsed.setdefault("datasets", [])
    parsed.setdefault("runs", [])
    return parsed


def _write_table(ws, rows: list[dict[str, Any]], start_row: int = 4) -> None:
    if not rows:
        ws.cell(row=start_row, column=1, value="No saved rows")
        return
    columns = list(rows[0].keys())
    for index, column in enumerate(columns, 1):
        cell = ws.cell(row=start_row, column=index, value=column)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center")
        cell.border = BORDER
    for row_index, row in enumerate(rows, start_row + 1):
        for column_index, column in enumerate(columns, 1):
            cell = ws.cell(row=row_index, column=column_index, value=_safe(row.get(column)))
            cell.border = BORDER
            if (row_index - start_row) % 2 == 0:
                cell.fill = STRIPE_FILL
    from openpyxl.utils import get_column_letter
    for index in range(1, ws.max_column + 1):
        width = max(
            (len(str(ws.cell(row=row, column=index).value)) for row in range(1, ws.max_row + 1) if ws.cell(row=row, column=index).value is not None),
            default=8,
        )
        ws.column_dimensions[get_column_letter(index)].width = min(width + 2, 42)


def _title(ws, title: str, subtitle: str, ncols: int) -> None:
    ncols = max(1, ncols)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    cell = ws.cell(row=1, column=1, value=title)
    cell.fill = TITLE_FILL
    cell.font = TITLE_FONT
    cell.alignment = Alignment(horizontal="left", indent=1)
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncols)
    ws.cell(row=2, column=1, value=subtitle)


def snapshot_report_bytes(snapshot: dict[str, Any]) -> bytes:
    workbook = Workbook()
    overview_sheet = workbook.active
    overview_sheet.title = "Overview"
    overview_rows = [
        {"Metric": "Dataset", "Value": snapshot.get("dataset_name")},
        {"Metric": "Source", "Value": snapshot.get("source_name")},
        {"Metric": "Profiled at", "Value": snapshot.get("profiled_at")},
        {"Metric": "Rows", "Value": snapshot.get("rows")},
        {"Metric": "Columns", "Value": snapshot.get("columns")},
        {"Metric": "Duplicate rows", "Value": snapshot.get("duplicate_rows")},
        {"Metric": "Missing cells", "Value": snapshot.get("missing_cells")},
        {"Metric": "Overall missing %", "Value": snapshot.get("overall_missing_percent")},
        {"Metric": "Memory MB", "Value": snapshot.get("memory_mb")},
    ]
    _title(overview_sheet, "Data Profiling Snapshot", "Recreated from saved aggregate profiling metrics", 2)
    _write_table(overview_sheet, overview_rows)
    basic = snapshot.get("basic_profile", [])
    basic_sheet = workbook.create_sheet("Basic Profile")
    _title(basic_sheet, "Basic Profile", "Saved profiling snapshot", len(basic[0]) if basic else 1)
    _write_table(basic_sheet, basic)
    advanced = snapshot.get("advanced_profile", [])
    advanced_sheet = workbook.create_sheet("Advanced Profile")
    _title(advanced_sheet, "Advanced Profile", "Saved profiling snapshot", len(advanced[0]) if advanced else 1)
    _write_table(advanced_sheet, advanced)
    if snapshot.get("ai_summary"):
        ai_sheet = workbook.create_sheet("AI Explanation")
        _title(ai_sheet, "Gemini Explanation", "Generated from aggregate profiling metrics", 1)
        ai_sheet.cell(row=4, column=1, value=snapshot["ai_summary"])
        ai_sheet.cell(row=4, column=1).alignment = Alignment(wrap_text=True, vertical="top")
        ai_sheet.column_dimensions["A"].width = 110
        ai_sheet.row_dimensions[4].height = 300
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
