"""Shared helpers for the full local Data Profiling Manager."""
from __future__ import annotations

import json
import re
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from ai_helper import generate_gemini_summary
from data_profiler import build_report, read_table
from schedule_helper import CADENCES, build_workflow_yaml_for_crons, cadence_to_cron, configs_to_csv
from snapshot_manager import (
    compare_runs,
    create_snapshot,
    dataset_runs,
    find_run,
    monitor_alerts,
    snapshot_report_bytes,
    successful_runs,
    trend_frame,
)

APP_DIR = Path(".profiling_manager")
REPORT_DIR = APP_DIR / "reports"
REGISTRY_PATH = APP_DIR / "dataset_registry.json"
HISTORY_PATH = APP_DIR / "profiling_history.jsonl"
FAILURE_PATH = APP_DIR / "profiling_failures.jsonl"
REPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PAGES = [
    "Dashboard",
    "Datasets",
    "Run profiling",
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


def ensure_dirs() -> None:
    APP_DIR.mkdir(exist_ok=True)
    REPORT_DIR.mkdir(exist_ok=True)


def clean_id(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-").lower()
    return value or f"dataset-{uuid.uuid4().hex[:8]}"


def unique_id(registry: list[dict[str, Any]], name: str) -> str:
    base = clean_id(name)
    existing = {item.get("id") for item in registry}
    if base not in existing:
        return base
    index = 2
    while f"{base}-{index}" in existing:
        index += 1
    return f"{base}-{index}"


def clean_filename(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip()).strip("_")
    return value or "dataset"


def _load_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def load_registry() -> list[dict[str, Any]]:
    ensure_dirs()
    return _load_json_list(REGISTRY_PATH)


def save_registry(registry: list[dict[str, Any]]) -> None:
    ensure_dirs()
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def _load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            if line.strip():
                value = json.loads(line)
                if isinstance(value, dict):
                    rows.append(value)
        except Exception:
            continue
    return rows


def load_history() -> list[dict[str, Any]]:
    ensure_dirs()
    return _load_jsonl(HISTORY_PATH)


def load_failures() -> list[dict[str, Any]]:
    ensure_dirs()
    return _load_jsonl(FAILURE_PATH)


def _save_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    ensure_dirs()
    path.write_text("".join(json.dumps(row, ensure_ascii=False, default=str) + "\n" for row in rows), encoding="utf-8")


def save_history(history: list[dict[str, Any]]) -> None:
    _save_jsonl(HISTORY_PATH, history)


def save_failures(failures: list[dict[str, Any]]) -> None:
    _save_jsonl(FAILURE_PATH, failures)


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    ensure_dirs()
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")


def append_history(run: dict[str, Any]) -> None:
    append_jsonl(HISTORY_PATH, run)


def append_failure(item: dict[str, Any], error: Exception) -> None:
    append_jsonl(
        FAILURE_PATH,
        {
            "event_id": uuid.uuid4().hex,
            "status": "failed",
            "dataset_id": item.get("id"),
            "dataset_name": item.get("name", "Dataset"),
            "source_name": item.get("source", ""),
            "profiled_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "error": (str(error) or error.__class__.__name__)[:500],
        },
    )


def profile_dataset(item: dict[str, Any]) -> dict[str, Any]:
    df = read_table(item["source"])
    run = create_snapshot(
        df,
        dataset_id=item["id"],
        dataset_name=item["name"],
        source_name=item["source"],
        owner=item.get("owner", ""),
    )
    report_path = REPORT_DIR / f"{clean_filename(item['name'])}_{datetime.now():%Y%m%d_%H%M%S}.xlsx"
    build_report(df, item["source"], str(report_path))
    run["report_path"] = str(report_path)
    run["run_source"] = "local"
    append_history(run)
    return run


def snapshot_ai_payload(run: dict[str, Any]) -> dict[str, Any]:
    missing = sorted(run.get("basic_profile", []), key=lambda row: float(row.get("Missing %") or 0), reverse=True)
    outliers = sorted(run.get("advanced_profile", []), key=lambda row: int(row.get("Outlier Count (IQR)") or 0), reverse=True)
    return {
        "dataset_name": run.get("dataset_name"),
        "profiled_at": run.get("profiled_at"),
        "rows": run.get("rows"),
        "columns": run.get("columns"),
        "duplicate_rows": run.get("duplicate_rows"),
        "total_missing_cells": run.get("missing_cells"),
        "overall_missing_percent": run.get("overall_missing_percent"),
        "columns_with_most_missing_values": [
            {"column": row.get("Column"), "missing_count": row.get("Missing"), "missing_percent": row.get("Missing %")}
            for row in missing[:15]
            if float(row.get("Missing %") or 0) > 0
        ],
        "numeric_columns_with_outliers": [
            {"column": row.get("Column"), "outlier_count_iqr": row.get("Outlier Count (IQR)"), "skewness": row.get("Skewness")}
            for row in outliers[:10]
            if int(row.get("Outlier Count (IQR)") or 0) > 0
        ],
    }


def workspace(registry: list[dict[str, Any]], history: list[dict[str, Any]], failures: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {"datasets": registry, "runs": history, "failures": failures or []}


def apply_brand() -> None:
    st.markdown(
        """
        <style>
        :root{--deep:#2D2A6E;--primary:#6C72CB;--soft:#EEF0FB;--ink:#202335;--border:#D9DDEA}
        .stApp{background:#fff;color:var(--ink)}.block-container{max-width:1480px;padding-top:4.4rem;padding-bottom:3rem}
        .brand{background:linear-gradient(135deg,var(--deep),var(--primary));color:#fff;padding:1.35rem 1.65rem;border-radius:20px;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;box-shadow:0 10px 28px rgba(45,42,110,.15)}
        .brand strong{font-size:clamp(1.6rem,2.6vw,2.15rem)}.brand span{opacity:.94}
        div[data-testid="stMetric"]{border:1px solid var(--border);border-radius:16px;padding:1rem 1.1rem;background:#fff}
        button[kind="primary"],.stDownloadButton button{background:var(--deep)!important;color:#fff!important;border-color:var(--deep)!important;border-radius:11px!important}
        [data-testid="stVerticalBlockBorderWrapper"]{border-color:var(--border)!important;border-radius:18px!important}
        .dpm-footer{color:#7A7F91;text-align:center;font-size:.82rem;padding:2rem 0 .5rem}
        @media(max-width:700px){.brand{align-items:flex-start;flex-direction:column}.block-container{padding-top:4.1rem}}
        </style>
        """,
        unsafe_allow_html=True,
    )
    st.markdown('<div class="brand"><strong>Data Profiling Manager</strong><span>Profile. Monitor. Compare.</span></div>', unsafe_allow_html=True)


def render_footer() -> None:
    st.markdown('<div class="dpm-footer">Data Profiling Manager · Created by Aanchal Dahiya</div>', unsafe_allow_html=True)


def run_label(run: dict[str, Any]) -> str:
    return f"{str(run.get('profiled_at', '')).replace('T', ' ')} · {int(run.get('rows', 0)):,} rows · {str(run.get('run_id', ''))[:6]}"


def backup_bytes() -> bytes:
    ensure_dirs()
    temp_root = Path(tempfile.mkdtemp()) / "data_profiling_manager_backup"
    temp_root.mkdir(parents=True)
    for source in [REGISTRY_PATH, HISTORY_PATH, FAILURE_PATH]:
        if source.exists():
            shutil.copy(source, temp_root / source.name)
    if REPORT_DIR.exists():
        shutil.copytree(REPORT_DIR, temp_root / "reports", dirs_exist_ok=True)
    archive = shutil.make_archive(str(temp_root), "zip", root_dir=temp_root)
    return Path(archive).read_bytes()
