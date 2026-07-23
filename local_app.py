"""Full local/self-hosted Data Profiling Manager.

Run:
    streamlit run local_app.py

This edition stores the registry, history, reports, and scheduling configuration
under .profiling_manager on the computer running the application.
"""
from __future__ import annotations

import json
import re
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st

from ai_helper import build_ai_payload, generate_gemini_summary
from data_profiler import advanced_profile, basic_profile, build_report, correlation_matrix
from schedule_helper import CADENCES, cadence_to_cron, config_to_csv

APP_DIR = Path(".profiling_manager")
REPORT_DIR = APP_DIR / "reports"
REGISTRY_PATH = APP_DIR / "dataset_registry.json"
RUN_LOG_PATH = APP_DIR / "run_history.jsonl"
REPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
SUPPORTED_SUFFIXES = {".csv", ".xlsx", ".xls", ".parquet"}


def ensure_dirs() -> None:
    APP_DIR.mkdir(exist_ok=True)
    REPORT_DIR.mkdir(exist_ok=True)


def clean_name(value: str) -> str:
    stem = Path(str(value)).stem.lower()
    stem = re.sub(r"[^a-z0-9_]+", "_", stem).strip("_")
    return stem or "dataset"


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def load_registry() -> list[dict[str, Any]]:
    ensure_dirs()
    if not REGISTRY_PATH.exists():
        return []
    try:
        value = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        return value if isinstance(value, list) else []
    except Exception:
        return []


def save_registry(registry: list[dict[str, Any]]) -> None:
    ensure_dirs()
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2, default=str), encoding="utf-8")


def load_history() -> list[dict[str, Any]]:
    ensure_dirs()
    if not RUN_LOG_PATH.exists():
        return []
    results: list[dict[str, Any]] = []
    for line in RUN_LOG_PATH.read_text(encoding="utf-8").splitlines():
        try:
            if line.strip():
                results.append(json.loads(line))
        except Exception:
            continue
    return results


def append_history(entry: dict[str, Any]) -> None:
    ensure_dirs()
    with RUN_LOG_PATH.open("a", encoding="utf-8") as file:
        file.write(json.dumps(entry, default=str) + "\n")


def read_source(source: str) -> pd.DataFrame:
    suffix = Path(source.split("?", 1)[0]).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise ValueError("Supported sources are CSV, Excel, and Parquet files.")
    if not source.startswith(("http://", "https://")):
        path = Path(source).expanduser()
        if not path.exists():
            raise FileNotFoundError(f"Could not find file: {path}")
        source = str(path)
    if suffix == ".csv":
        return pd.read_csv(source)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(source)
    return pd.read_parquet(source)


def get_dataset(registry: list[dict[str, Any]], dataset_id: str) -> dict[str, Any] | None:
    return next((item for item in registry if item.get("id") == dataset_id), None)


def profile_dataset(dataset: dict[str, Any]) -> dict[str, Any]:
    df = read_source(dataset["source"])
    run_id = timestamp()
    report_path = REPORT_DIR / f"{clean_name(dataset['dataset'])}_profiling_{run_id}.xlsx"
    build_report(df, dataset["source"], str(report_path))
    entry = {
        "run_id": run_id,
        "dataset_id": dataset["id"],
        "dataset": dataset["dataset"],
        "source": dataset["source"],
        "report_path": str(report_path),
        "profiled_at": datetime.now().isoformat(timespec="seconds"),
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "duplicate_rows": int(df.duplicated().sum()),
        "missing_cells": int(df.isna().sum().sum()),
        "status": "success",
    }
    append_history(entry)
    return entry


def backup_bytes() -> bytes:
    ensure_dirs()
    root = Path(tempfile.mkdtemp()) / "data_profiling_manager_backup"
    root.mkdir(parents=True)
    for path in (REGISTRY_PATH, RUN_LOG_PATH):
        if path.exists():
            shutil.copy(path, root / path.name)
    if REPORT_DIR.exists():
        shutil.copytree(REPORT_DIR, root / "reports", dirs_exist_ok=True)
    zip_path = shutil.make_archive(str(root), "zip", root_dir=root)
    return Path(zip_path).read_bytes()


def apply_brand() -> None:
    st.markdown(
        """
        <style>
        .stApp { background: #ffffff; }
        .block-container { max-width: 1450px; padding-top: 1.2rem; }
        .brand-header { background:#68053f;color:white;margin:-1.2rem -5rem 1.25rem -5rem;padding:1.45rem 5rem;display:flex;justify-content:space-between;align-items:center; }
        .brand-title { font-size:2rem;font-weight:760; }
        .brand-subtitle { font-size:1rem;opacity:.92; }
        div[data-testid="stMetric"] { border:1px solid #dedfe6;border-radius:16px;padding:1rem 1.1rem;background:#fff; }
        button[kind="primary"], .stDownloadButton button { background:#68053f !important;color:white !important;border-color:#68053f !important;border-radius:11px !important; }
        .stTabs [data-baseweb="tab-list"] { gap:.55rem;flex-wrap:wrap; }
        .stTabs [data-baseweb="tab"] { border:1px solid #dedfe6;border-radius:14px;padding:.55rem 1.05rem;background:#fafafa; }
        .stTabs [aria-selected="true"] { background:#fff0f8 !important;color:#68053f !important;font-weight:700; }
        </style>
        """,
        unsafe_allow_html=True,
    )
    st.markdown('<div class="brand-header"><div class="brand-title">Data Profiling Manager</div><div class="brand-subtitle">Local • Private • Scheduled</div></div>', unsafe_allow_html=True)


def dataset_schedule_config(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "dataset_id": item.get("id"),
        "dataset": item.get("dataset"),
        "source": item.get("source"),
        "recipient_name": item.get("recipient_name", ""),
        "recipient_email": item.get("recipient_email", ""),
        "cadence": item.get("cadence", "Monthly"),
        "weekday": item.get("weekday", "Monday"),
        "day_of_month": int(item.get("day_of_month", 1)),
        "month": int(item.get("month", 1)),
        "hour_utc": int(item.get("hour_utc", 7)),
        "minute": int(item.get("minute", 15)),
        "ai_summary": bool(item.get("ai_summary", False)),
    }


ensure_dirs()
st.set_page_config(page_title="Data Profiling Manager — Local", page_icon="📊", layout="wide")
apply_brand()
registry = load_registry()
history = load_history()

tab_dashboard, tab_datasets, tab_run, tab_upload, tab_history, tab_schedule, tab_settings = st.tabs(
    ["Dashboard", "Datasets", "Run profiling", "Ad hoc upload", "History", "Scheduling & email", "Settings"]
)

with tab_dashboard:
    st.header("Dashboard")
    scheduled = [item for item in registry if item.get("schedule_enabled")]
    successful = [row for row in history if row.get("status") == "success"]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Registered datasets", len(registry))
    c2.metric("Scheduled datasets", len(scheduled))
    c3.metric("Total runs", len(successful))
    c4.metric("Generated reports", len(list(REPORT_DIR.glob("*.xlsx"))))
    if not registry:
        st.info("No datasets are registered yet. Add one in the Datasets tab.")
    else:
        rows = []
        for item in registry:
            last = next((row for row in reversed(history) if row.get("dataset_id") == item.get("id") and row.get("status") == "success"), None)
            rows.append({
                "Dataset": item.get("dataset"),
                "Owner": item.get("owner", ""),
                "Recipient": item.get("recipient_email", ""),
                "Schedule": item.get("cadence", "None") if item.get("schedule_enabled") else "None",
                "Last profiled": last.get("profiled_at") if last else "Never",
                "Rows": last.get("rows") if last else None,
                "Source": item.get("source"),
            })
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

with tab_datasets:
    st.header("Datasets")
    mode = st.radio("Action", ["Add dataset", "Edit dataset", "Delete dataset"], horizontal=True)
    selected: dict[str, Any] | None = None
    if mode != "Add dataset" and registry:
        labels = {f"{item['dataset']} — {item.get('source', '')}": item["id"] for item in registry}
        selected_label = st.selectbox("Choose dataset", list(labels))
        selected = get_dataset(registry, labels[selected_label])

    if mode == "Delete dataset":
        if not registry:
            st.info("No datasets to delete.")
        elif selected and st.button("Delete selected dataset"):
            registry = [item for item in registry if item.get("id") != selected.get("id")]
            save_registry(registry)
            st.success("Dataset removed. Existing reports and history were retained.")
            st.rerun()
    else:
        existing = selected or {}
        with st.form("dataset_form"):
            dataset = st.text_input("Dataset name", value=existing.get("dataset", ""))
            source = st.text_input("Local file path or downloadable URL", value=existing.get("source", ""), placeholder="/Users/you/data/customers.csv")
            owner = st.text_input("Owner", value=existing.get("owner", ""))
            recipient_name = st.text_input("Report recipient name", value=existing.get("recipient_name", ""))
            recipient_email = st.text_input("Report recipient email", value=existing.get("recipient_email", ""))
            schedule_enabled = st.checkbox("Schedule profiling and email delivery", value=bool(existing.get("schedule_enabled", False)))
            c1, c2, c3, c4 = st.columns(4)
            cadence = c1.selectbox("Cadence", CADENCES, index=CADENCES.index(existing.get("cadence", "Monthly")) if existing.get("cadence") in CADENCES else 1)
            weekday_options = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            weekday = c2.selectbox("Weekday", weekday_options, index=weekday_options.index(existing.get("weekday", "Monday")))
            day_of_month = c3.number_input("Day of month", 1, 28, int(existing.get("day_of_month", 1)))
            month = c4.number_input("Month for yearly", 1, 12, int(existing.get("month", 1)))
            c5, c6 = st.columns(2)
            hour_utc = c5.number_input("Hour (UTC)", 0, 23, int(existing.get("hour_utc", 7)))
            minute = c6.number_input("Minute", 0, 59, int(existing.get("minute", 15)))
            ai_summary = st.checkbox("Include Gemini explanation when a Gemini key is configured", value=bool(existing.get("ai_summary", False)))
            save = st.form_submit_button("Save dataset")
        if save:
            if not dataset or not source:
                st.error("Dataset name and source are required.")
            else:
                item = {
                    "id": existing.get("id") or clean_name(dataset),
                    "dataset": dataset,
                    "source": source,
                    "owner": owner,
                    "recipient_name": recipient_name,
                    "recipient_email": recipient_email,
                    "schedule_enabled": bool(schedule_enabled),
                    "cadence": cadence,
                    "weekday": weekday,
                    "day_of_month": int(day_of_month),
                    "month": int(month),
                    "hour_utc": int(hour_utc),
                    "minute": int(minute),
                    "ai_summary": bool(ai_summary),
                    "updated_at": datetime.now().isoformat(timespec="seconds"),
                }
                target = get_dataset(registry, item["id"])
                if target:
                    target.update(item)
                else:
                    item["created_at"] = item["updated_at"]
                    registry.append(item)
                registry.sort(key=lambda value: value.get("dataset", "").lower())
                save_registry(registry)
                st.success("Dataset saved.")
                st.rerun()

with tab_run:
    st.header("Run profiling")
    if not registry:
        st.info("Register a dataset first.")
    else:
        labels = {f"{item['dataset']} — {item.get('source', '')}": item["id"] for item in registry}
        selected_label = st.selectbox("Select dataset", list(labels), key="run_dataset")
        item = get_dataset(registry, labels[selected_label])
        if item:
            st.code(item["source"], language=None)
            if st.button("Profile now", type="primary"):
                try:
                    with st.spinner("Profiling dataset…"):
                        result = profile_dataset(item)
                    item["last_profiled"] = result["profiled_at"]
                    item["last_report_path"] = result["report_path"]
                    save_registry(registry)
                    st.success("Profile completed.")
                    st.json({key: result[key] for key in ["rows", "columns", "duplicate_rows", "missing_cells"]})
                    with open(result["report_path"], "rb") as file:
                        st.download_button("Download report", file.read(), Path(result["report_path"]).name, REPORT_MIME)
                except Exception as exc:
                    append_history({
                        "run_id": timestamp(),
                        "dataset_id": item.get("id"),
                        "dataset": item.get("dataset"),
                        "source": item.get("source"),
                        "profiled_at": datetime.now().isoformat(timespec="seconds"),
                        "status": f"failed: {exc}",
                    })
                    st.error(f"Profiling failed: {exc}")

with tab_upload:
    st.header("Ad hoc upload")
    uploaded = st.file_uploader("Choose CSV, Excel, or Parquet", type=["csv", "xlsx", "xls", "parquet"], key="local_upload")
    if uploaded:
        try:
            suffix = Path(uploaded.name).suffix.lower()
            uploaded.seek(0)
            if suffix == ".csv":
                df = pd.read_csv(uploaded)
            elif suffix in {".xlsx", ".xls"}:
                df = pd.read_excel(uploaded)
            else:
                df = pd.read_parquet(uploaded)
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("Rows", f"{len(df):,}")
            c2.metric("Columns", f"{df.shape[1]:,}")
            c3.metric("Duplicates", f"{df.duplicated().sum():,}")
            c4.metric("Missing cells", f"{int(df.isna().sum().sum()):,}")
            basic_tab, advanced_tab, corr_tab = st.tabs(["Basic profile", "Advanced profile", "Correlation"])
            with basic_tab:
                st.dataframe(basic_profile(df), use_container_width=True, hide_index=True)
            with advanced_tab:
                st.dataframe(advanced_profile(df), use_container_width=True, hide_index=True)
            with corr_tab:
                corr = correlation_matrix(df)
                if corr is not None:
                    st.dataframe(corr, use_container_width=True, hide_index=True)
                else:
                    st.info("At least two numeric columns are required.")
            temp_path = Path(tempfile.mkstemp(suffix=".xlsx")[1])
            try:
                build_report(df, uploaded.name, str(temp_path))
                st.download_button("Download Excel report", temp_path.read_bytes(), f"{clean_name(uploaded.name)}_profiling_report.xlsx", REPORT_MIME)
            finally:
                temp_path.unlink(missing_ok=True)
        except Exception as exc:
            st.error(f"Could not profile {uploaded.name}: {exc}")

with tab_history:
    st.header("History")
    history = load_history()
    if not history:
        st.info("No profiling history yet.")
    else:
        history_df = pd.DataFrame(history)
        if "profiled_at" in history_df:
            history_df = history_df.sort_values("profiled_at", ascending=False)
        st.dataframe(history_df, use_container_width=True, hide_index=True)
        st.download_button("Download history JSONL", RUN_LOG_PATH.read_text(encoding="utf-8"), "run_history.jsonl", "application/json")
        reports = [row for row in history if row.get("status") == "success" and row.get("report_path") and Path(row["report_path"]).exists()]
        if reports:
            labels = {f"{row['dataset']} — {row['profiled_at']}": row for row in reports}
            label = st.selectbox("Download a previous report", list(labels))
            report = labels[label]
            path = Path(report["report_path"])
            st.download_button("Download selected report", path.read_bytes(), path.name, REPORT_MIME)

with tab_schedule:
    st.header("Scheduling & email")
    st.caption("The manager stores schedule preferences. The runner performs the recurring job through GitHub Actions, cron, or Windows Task Scheduler.")
    scheduled = [item for item in registry if item.get("schedule_enabled")]
    if not scheduled:
        st.info("Enable scheduling on at least one dataset in the Datasets tab.")
    else:
        rows = []
        for item in scheduled:
            config = dataset_schedule_config(item)
            rows.append({
                "Dataset": item.get("dataset"),
                "Recipient": item.get("recipient_email"),
                "Cadence": item.get("cadence"),
                "Cron (UTC)": cadence_to_cron(config),
                "AI explanation": item.get("ai_summary", False),
                "Source": item.get("source"),
            })
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

        config_rows = [config_to_csv(dataset_schedule_config(item)).splitlines() for item in scheduled]
        header = config_rows[0][0]
        combined_csv = header + "\n" + "\n".join(lines[1] for lines in config_rows) + "\n"
        unique_crons = []
        for item in scheduled:
            cron = cadence_to_cron(dataset_schedule_config(item))
            if cron not in unique_crons:
                unique_crons.append(cron)
        cron_lines = "\n".join(f'    - cron: "{cron}"' for cron in unique_crons)
        workflow = f'''# Generated by Data Profiling Manager. GitHub cron uses UTC.
name: Scheduled Data Profiling

on:
  schedule:
{cron_lines}
  workflow_dispatch:

jobs:
  profile-and-email:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
      - run: pip install -r requirements.txt
      - run: python monthly_profiling_agent.py --cron "${{{{ github.event.schedule }}}}"
        env:
          SMTP_HOST: ${{{{ secrets.SMTP_HOST }}}}
          SMTP_PORT: ${{{{ secrets.SMTP_PORT }}}}
          SMTP_USER: ${{{{ secrets.SMTP_USER }}}}
          SMTP_PASS: ${{{{ secrets.SMTP_PASS }}}}
          GEMINI_API_KEY: ${{{{ secrets.GEMINI_API_KEY }}}}
          GEMINI_MODEL: gemini-2.5-flash
'''
        c1, c2 = st.columns(2)
        c1.download_button("Download schedule_config.csv", combined_csv, "schedule_config.csv", "text/csv")
        c2.download_button("Download scheduled workflow", workflow, "scheduled_profiling.yml", "text/yaml")
        with st.expander("Workflow preview"):
            st.code(workflow, language="yaml")
        st.markdown(
            """
**To send email reports automatically:**

1. Put `schedule_config.csv` beside `monthly_profiling_agent.py`.
2. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS`.
3. Optionally configure `GEMINI_API_KEY`.
4. Run the agent with GitHub Actions, cron, or Windows Task Scheduler.

For private files on your computer, use a local scheduler. A GitHub-hosted runner cannot read your laptop's file path.
            """
        )

with tab_settings:
    st.header("Settings")
    st.write(f"Registry: `{REGISTRY_PATH}`")
    st.write(f"History: `{RUN_LOG_PATH}`")
    st.write(f"Reports: `{REPORT_DIR}`")
    st.download_button("Download local backup", backup_bytes(), "data_profiling_manager_backup.zip", "application/zip")
    st.markdown(
        """
### Optional Gemini test
Enter a key below to verify that the local app can generate an aggregate-only explanation. The key remains in the current Streamlit session and is not written to the registry.
        """
    )
    api_key = st.text_input("Gemini API key", type="password", key="local_gemini_key")
    if st.button("Test Gemini using latest registered dataset"):
        if not api_key or not registry:
            st.error("Enter a key and register a dataset first.")
        else:
            try:
                item = registry[0]
                df = read_source(item["source"])
                result = generate_gemini_summary(api_key, build_ai_payload(df, item["dataset"]), "gemini-2.5-flash")
                st.markdown(result)
            except Exception as exc:
                st.error(f"Gemini test failed: {exc}")