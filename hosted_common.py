"""Data Profiling Manager — persistent public Streamlit edition.

The public app stores dataset registry and aggregate profiling snapshots in the
visitor's browser localStorage. Raw uploaded files, report bytes, and Gemini API
keys are not persisted by the app.
"""
from __future__ import annotations

import html
import json
import re
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from ai_helper import generate_gemini_summary
from browser_storage import browser_storage_value
from data_profiler import advanced_profile, basic_profile, build_report, correlation_matrix
from schedule_helper import CADENCES, build_workflow_yaml, build_workflow_yaml_for_crons, cadence_to_cron, config_to_csv, configs_to_csv
from snapshot_manager import (
    add_snapshot,
    clean_id,
    compare_runs,
    create_snapshot,
    dataset_runs,
    empty_workspace,
    find_run,
    latest_run,
    snapshot_report_bytes,
    trend_frame,
    update_ai_summary,
    upsert_dataset,
    workspace_from_json,
    workspace_to_json,
)

STORAGE_KEY = "data_profiling_manager_workspace_v1"
REPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_UPLOAD_MB = 50
PAGES = ["Dashboard", "Datasets", "Profile", "History", "Compare", "Trends", "AI explanation", "Scheduling", "Settings"]


def clean_filename(value: str) -> str:
    stem = Path(value).stem.lower()
    stem = re.sub(r"[^a-z0-9_]+", "_", stem).strip("_")
    return stem or "dataset"


def read_uploaded_file(uploaded_file) -> pd.DataFrame:
    uploaded_file.seek(0)
    suffix = Path(uploaded_file.name).suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(uploaded_file)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(uploaded_file)
    if suffix == ".parquet":
        return pd.read_parquet(uploaded_file)
    raise ValueError(f"Unsupported file type: {suffix}")


def report_bytes(df: pd.DataFrame, source_name: str) -> bytes:
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            temp_path = Path(tmp.name)
        build_report(df, source_name, str(temp_path))
        return temp_path.read_bytes()
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def apply_brand() -> None:
    st.markdown(
        """
        <style>
        :root {
            --dpm-deep: #2D2A6E;
            --dpm-primary: #6C72CB;
            --dpm-soft: #EEF0FB;
            --dpm-ink: #202335;
            --dpm-muted: #667085;
            --dpm-border: #D9DDEA;
            --dpm-warn: #F59E0B;
        }
        .stApp { background: #FFFFFF; color: var(--dpm-ink); }
        .block-container { max-width: 1480px; padding-top: 4.65rem; padding-bottom: 3rem; }
        .brand-header {
            background: linear-gradient(135deg, var(--dpm-deep), var(--dpm-primary));
            color: white; padding: 1.35rem 1.65rem; margin: 0 0 1.05rem 0;
            border-radius: 20px; display:flex; justify-content:space-between;
            align-items:center; gap:1rem; box-shadow:0 10px 28px rgba(45,42,110,.15);
        }
        .brand-title { font-size:clamp(1.6rem,2.6vw,2.15rem); font-weight:780; line-height:1.15; }
        .brand-subtitle { font-size:1rem; opacity:.94; white-space:nowrap; }
        .dashboard-banner {
            background:var(--dpm-deep); color:white; border-radius:18px; padding:1.3rem 1.45rem;
            margin:.3rem 0 1.05rem 0; display:flex; justify-content:space-between; align-items:center; gap:1rem;
        }
        .dashboard-title { font-size:1.55rem; font-weight:760; margin-bottom:.25rem; }
        .dashboard-meta { color:#D9DBFF; font-size:.97rem; }
        .run-badge { background:#858AE3; padding:.42rem .85rem; border-radius:999px; font-weight:700; white-space:nowrap; }
        h1,h2,h3,h4 { color:var(--dpm-ink); line-height:1.25 !important; }
        div[data-testid="stMetric"] { border:1px solid var(--dpm-border); border-radius:16px; padding:1rem 1.1rem; background:white; box-shadow:0 3px 12px rgba(32,35,53,.04); }
        button[kind="primary"], .stDownloadButton button { background:var(--dpm-deep)!important; color:white!important; border-color:var(--dpm-deep)!important; border-radius:11px!important; }
        button[kind="secondary"] { border-color:var(--dpm-primary)!important; color:var(--dpm-deep)!important; border-radius:11px!important; }
        div[role="radiogroup"] { gap:.38rem; flex-wrap:wrap; margin-bottom:.65rem; }
        div[role="radiogroup"] > label { border:1px solid var(--dpm-border); border-radius:999px; padding:.38rem .72rem; background:#FAFAFC; }
        div[role="radiogroup"] > label:has(input:checked) { background:var(--dpm-soft); border-color:var(--dpm-primary); color:var(--dpm-deep); font-weight:700; }
        div[role="radiogroup"] > label > div:first-child { display:none; }
        [data-testid="stVerticalBlockBorderWrapper"] { border-color:var(--dpm-border)!important; border-radius:18px!important; box-shadow:0 4px 16px rgba(32,35,53,.035); }
        .section-intro { color:var(--dpm-muted); margin-top:-.35rem; margin-bottom:1rem; }
        .ai-panel { background:#F0F1FF; border:1px solid #8A8FE4; color:#30358C; border-radius:16px; padding:1rem 1.1rem; }
        .fact-list { border:1px solid var(--dpm-border); border-radius:16px; padding:.55rem 1rem; background:#fff; }
        @media(max-width:700px){ .block-container{padding-top:4.2rem}.brand-header,.dashboard-banner{align-items:flex-start;flex-direction:column}.brand-subtitle{white-space:normal} }
        </style>
        """,
        unsafe_allow_html=True,
    )
    st.markdown(
        '<div class="brand-header"><div class="brand-title">Data Profiling Manager</div><div class="brand-subtitle">Profile. Monitor. Compare.</div></div>',
        unsafe_allow_html=True,
    )


def persist_workspace(workspace: dict[str, Any]) -> None:
    raw = workspace_to_json(workspace)
    st.session_state["workspace"] = workspace
    st.session_state["_pending_storage"] = ("write", raw)
    st.session_state["_last_storage_raw"] = raw


def clear_workspace() -> None:
    st.session_state["workspace"] = empty_workspace()
    st.session_state["current_run_id"] = None
    st.session_state["_pending_storage"] = ("clear", "")
    st.session_state["_last_storage_raw"] = ""


def initialize_workspace() -> tuple[dict[str, Any], str | None]:
    pending = st.session_state.pop("_pending_storage", None)
    command, value = pending if pending else ("read", "")
    storage = browser_storage_value(STORAGE_KEY, command=command, value=value)

    if not pending:
        previous_raw = st.session_state.get("_last_storage_raw")
        if previous_raw is None or storage.value != previous_raw:
            try:
                workspace = workspace_from_json(storage.value)
            except Exception:
                workspace = empty_workspace()
                st.session_state["storage_load_error"] = "The browser history could not be read. You can import a backup from Settings."
            st.session_state["workspace"] = workspace
            st.session_state["_last_storage_raw"] = storage.value

    workspace = st.session_state.setdefault("workspace", empty_workspace())
    return workspace, storage.error or None


def set_page(page: str) -> None:
    st.session_state["page"] = page
    st.session_state["nav_page"] = page


def run_label(run: dict[str, Any]) -> str:
    when = str(run.get("profiled_at", "")).replace("T", " ").replace("+00:00", " UTC")
    return f"{when} · {run.get('rows', 0):,} rows · {run.get('source_name', '')}"


def selected_run(workspace: dict[str, Any]) -> dict[str, Any] | None:
    run = find_run(workspace, st.session_state.get("current_run_id"))
    if run:
        return run
    run = latest_run(workspace)
    if run:
        st.session_state["current_run_id"] = run["run_id"]
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
        "memory_mb": run.get("memory_mb"),
        "columns_with_most_missing_values": [
            {
                "column": row.get("Column"),
                "dtype": row.get("Dtype"),
                "missing_count": row.get("Missing"),
                "missing_percent": row.get("Missing %"),
                "unique_count": row.get("Unique"),
            }
            for row in missing[:15]
            if float(row.get("Missing %") or 0) > 0
        ],
        "numeric_columns_with_outliers": [
            {
                "column": row.get("Column"),
                "outlier_count_iqr": row.get("Outlier Count (IQR)"),
                "skewness": row.get("Skewness"),
            }
            for row in outliers[:10]
            if int(row.get("Outlier Count (IQR)") or 0) > 0
        ],
        "constant_columns": [row.get("Column") for row in run.get("advanced_profile", []) if row.get("Key Candidate Flag") == "Constant"],
        "likely_key_columns": [row.get("Column") for row in run.get("advanced_profile", []) if row.get("Key Candidate Flag") == "Likely Key"],
    }
