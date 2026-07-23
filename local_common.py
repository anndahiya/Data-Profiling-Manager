"""Full local Data Profiling Manager shared helpers.

The local edition stores dataset records, profiling snapshots, reports, AI
explanations, and schedule settings under ``.profiling_manager`` on the machine
running the app.
"""
from __future__ import annotations

import json
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import altair as alt
import pandas as pd
import streamlit as st

from ai_helper import generate_gemini_summary
from data_profiler import build_report
from schedule_helper import CADENCES, build_workflow_yaml_for_crons, cadence_to_cron, configs_to_csv
from snapshot_manager import compare_runs, create_snapshot, dataset_runs, find_run, snapshot_report_bytes, trend_frame

APP_DIR = Path(".profiling_manager")
REPORT_DIR = APP_DIR / "reports"
REGISTRY_PATH = APP_DIR / "dataset_registry.json"
HISTORY_PATH = APP_DIR / "profiling_history.jsonl"
REPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
SUPPORTED_SUFFIXES = {".csv", ".xlsx", ".xls", ".parquet"}
PAGES = ["Dashboard", "Datasets", "Run profiling", "History", "Compare", "Trends", "AI explanation", "Scheduling", "Settings"]


def ensure_dirs() -> None:
    APP_DIR.mkdir(exist_ok=True)
    REPORT_DIR.mkdir(exist_ok=True)


def clean_id(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip()).strip("-").lower()
    return value or f"dataset-{datetime.now():%H%M%S}"


def clean_filename(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9_-]+", "_", value.strip()).strip("_")
    return value or "dataset"


def load_registry() -> list[dict[str, Any]]:
    ensure_dirs()
    if not REGISTRY_PATH.exists():
        return []
    try:
        parsed = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def save_registry(registry: list[dict[str, Any]]) -> None:
    ensure_dirs()
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8")


def load_history() -> list[dict[str, Any]]:
    ensure_dirs()
    if not HISTORY_PATH.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in HISTORY_PATH.read_text(encoding="utf-8").splitlines():
        try:
            if line.strip():
                value = json.loads(line)
                if isinstance(value, dict):
                    rows.append(value)
        except Exception:
            continue
    return rows


def save_history(history: list[dict[str, Any]]) -> None:
    ensure_dirs()
    HISTORY_PATH.write_text(
        "".join(json.dumps(row, ensure_ascii=False, default=str) + "\n" for row in history),
        encoding="utf-8",
    )


def append_history(run: dict[str, Any]) -> None:
    ensure_dirs()
    with HISTORY_PATH.open("a", encoding="utf-8") as file:
        file.write(json.dumps(run, ensure_ascii=False, default=str) + "\n")


def read_source(source: str) -> pd.DataFrame:
    suffix = Path(source.split("?", 1)[0]).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ValueError("Supported sources are CSV, Excel, and Parquet files.")
    resolved = source
    if not source.startswith(("http://", "https://")):
        path = Path(source).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"Could not find file: {path}")
        resolved = str(path)
    if suffix == ".csv":
        return pd.read_csv(resolved)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(resolved)
    return pd.read_parquet(resolved)


def profile_dataset(item: dict[str, Any]) -> dict[str, Any]:
    df = read_source(item["source"])
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
            for row in missing[:15] if float(row.get("Missing %") or 0) > 0
        ],
        "numeric_columns_with_outliers": [
            {"column": row.get("Column"), "outlier_count_iqr": row.get("Outlier Count (IQR)"), "skewness": row.get("Skewness")}
            for row in outliers[:10] if int(row.get("Outlier Count (IQR)") or 0) > 0
        ],
    }


def apply_brand() -> None:
    st.markdown(
        """
        <style>
        :root { --deep:#2D2A6E; --primary:#6C72CB; --soft:#EEF0FB; --ink:#202335; --border:#D9DDEA; }
        .stApp{background:#fff;color:var(--ink)} .block-container{max-width:1480px;padding-top:4.65rem;padding-bottom:3rem}
        .brand{background:linear-gradient(135deg,var(--deep),var(--primary));color:#fff;padding:1.35rem 1.65rem;border-radius:20px;margin-bottom:1rem;display:flex;justify-content:space-between;align-items:center;box-shadow:0 10px 28px rgba(45,42,110,.15)}
        .brand strong{font-size:clamp(1.6rem,2.6vw,2.15rem)} .brand span{opacity:.94}
        div[data-testid="stMetric"]{border:1px solid var(--border);border-radius:16px;padding:1rem 1.1rem;background:#fff}
        button[kind="primary"],.stDownloadButton button{background:var(--deep)!important;color:#fff!important;border-color:var(--deep)!important;border-radius:11px!important}
        div[role="radiogroup"]{gap:.38rem;flex-wrap:wrap} div[role="radiogroup"]>label{border:1px solid var(--border);border-radius:999px;padding:.38rem .72rem;background:#fafafc}
        div[role="radiogroup"]>label:has(input:checked){background:var(--soft);border-color:var(--primary);color:var(--deep);font-weight:700} div[role="radiogroup"]>label>div:first-child{display:none}
        [data-testid="stVerticalBlockBorderWrapper"]{border-color:var(--border)!important;border-radius:18px!important}
        @media(max-width:700px){.brand{align-items:flex-start;flex-direction:column}.block-container{padding-top:4.2rem}}
        </style>
        """,
        unsafe_allow_html=True,
    )
    st.markdown('<div class="brand"><strong>Data Profiling Manager</strong><span>Profile. Monitor. Compare.</span></div>', unsafe_allow_html=True)


def set_page(page: str) -> None:
    st.session_state["page"] = page
    st.session_state["nav_page"] = page


def run_label(run: dict[str, Any]) -> str:
    return f"{str(run.get('profiled_at', '')).replace('T', ' ')} · {run.get('rows', 0):,} rows"


def backup_bytes() -> bytes:
    ensure_dirs()
    temp_root = Path(tempfile.mkdtemp()) / "data_profiling_manager_backup"
    temp_root.mkdir(parents=True)
    for source in [REGISTRY_PATH, HISTORY_PATH]:
        if source.exists():
            shutil.copy(source, temp_root / source.name)
    if REPORT_DIR.exists():
        shutil.copytree(REPORT_DIR, temp_root / "reports", dirs_exist_ok=True)
    archive = shutil.make_archive(str(temp_root), "zip", root_dir=temp_root)
    return Path(archive).read_bytes()
