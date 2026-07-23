"""Public Streamlit edition of Data Profiling Manager.

This entry point is safe for a shared hosted deployment: uploaded data and API
keys are kept in the visitor's current session. It also restores the original
branded manager layout and schedule/email setup flow.
"""
from __future__ import annotations

import re
import tempfile
from pathlib import Path

import pandas as pd
import streamlit as st

from ai_helper import build_ai_payload, generate_gemini_summary
from data_profiler import advanced_profile, basic_profile, build_report, correlation_matrix
from schedule_helper import CADENCES, build_workflow_yaml, config_to_csv

REPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_UPLOAD_MB = 50
MAX_PREVIEW_ROWS = 50


def clean_name(name: str) -> str:
    stem = Path(name).stem.lower()
    stem = re.sub(r"[^a-z0-9_]+", "_", stem).strip("_")
    return stem or "dataset"


def read_uploaded_file(uploaded_file) -> pd.DataFrame:
    suffix = Path(uploaded_file.name).suffix.lower()
    uploaded_file.seek(0)
    if suffix == ".csv":
        return pd.read_csv(uploaded_file)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(uploaded_file)
    if suffix == ".parquet":
        return pd.read_parquet(uploaded_file)
    raise ValueError(f"Unsupported file type: {suffix}")


def report_bytes(df: pd.DataFrame, source_name: str) -> bytes:
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            path = Path(tmp.name)
        build_report(df, source_name, str(path))
        return path.read_bytes()
    finally:
        if path and path.exists():
            path.unlink(missing_ok=True)


def apply_brand() -> None:
    st.markdown(
        """
        <style>
        .stApp { background: #ffffff; }
        .block-container { max-width: 1450px; padding-top: 1.2rem; }
        .brand-header {
            background: #68053f;
            color: white;
            margin: -1.2rem -5rem 1.25rem -5rem;
            padding: 1.45rem 5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .brand-title { font-size: 2rem; font-weight: 760; margin: 0; }
        .brand-subtitle { font-size: 1rem; opacity: .92; }
        div[data-testid="stMetric"] {
            border: 1px solid #dedfe6;
            border-radius: 16px;
            padding: 1rem 1.1rem;
            background: #fff;
        }
        button[kind="primary"], .stDownloadButton button {
            background: #68053f !important;
            color: white !important;
            border-color: #68053f !important;
            border-radius: 11px !important;
        }
        button[kind="primary"]:hover, .stDownloadButton button:hover {
            background: #520331 !important;
            border-color: #520331 !important;
        }
        .stTabs [data-baseweb="tab-list"] { gap: .55rem; flex-wrap: wrap; }
        .stTabs [data-baseweb="tab"] {
            border: 1px solid #dedfe6;
            border-radius: 14px;
            padding: .55rem 1.05rem;
            background: #fafafa;
        }
        .stTabs [aria-selected="true"] {
            background: #fff0f8 !important;
            color: #68053f !important;
            font-weight: 700;
        }
        .feature-card {
            border: 1px solid #dedfe6;
            border-radius: 16px;
            padding: 1.2rem;
            min-height: 150px;
        }
        .muted { color: #697386; }
        </style>
        """,
        unsafe_allow_html=True,
    )
    st.markdown(
        """
        <div class="brand-header">
          <div class="brand-title">Data Profiling Manager</div>
          <div class="brand-subtitle">Profile • Explain • Schedule</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


st.set_page_config(page_title="Data Profiling Manager", page_icon="📊", layout="wide")
apply_brand()

for key, default in {
    "profile_df": None,
    "profile_name": None,
    "profile_size_mb": None,
    "ai_summary": None,
}.items():
    st.session_state.setdefault(key, default)

with st.expander("Privacy and hosted-app limits", expanded=False):
    st.markdown(
        """
- Uploads and Gemini keys are used only in the current visitor session by this app.
- Other visitors are not given a way to browse your upload, key, or results.
- A public hosted instance should not be used for confidential, regulated, or highly sensitive data.
- Only aggregate profiling metrics—not raw rows or sample values—are sent to Gemini.
- **Scheduled runs cannot reuse a temporary browser upload after the session ends.** Use a durable source and your own runner, or run the local edition for private local files.
        """
    )

tab_dashboard, tab_profile, tab_ai, tab_schedule, tab_local = st.tabs(
    ["Dashboard", "Profile dataset", "AI explanation", "Scheduling & email", "Local manager"]
)

with tab_dashboard:
    st.header("Dashboard")
    st.caption("The hosted edition is for immediate profiling. The repository also includes a full local manager with saved datasets, history, and private scheduling.")
    df = st.session_state["profile_df"]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Current dataset", st.session_state["profile_name"] or "None")
    c2.metric("Rows", f"{len(df):,}" if isinstance(df, pd.DataFrame) else "—")
    c3.metric("Columns", f"{df.shape[1]:,}" if isinstance(df, pd.DataFrame) else "—")
    c4.metric("Duplicate rows", f"{df.duplicated().sum():,}" if isinstance(df, pd.DataFrame) else "—")
    st.markdown("### Choose how you want to use it")
    a, b, c = st.columns(3)
    a.markdown('<div class="feature-card"><h4>Profile now</h4><p class="muted">Upload CSV, Excel, or Parquet and download a report immediately.</p></div>', unsafe_allow_html=True)
    b.markdown('<div class="feature-card"><h4>Explain with Gemini</h4><p class="muted">Use your own API key. Gemini receives aggregate metrics only.</p></div>', unsafe_allow_html=True)
    c.markdown('<div class="feature-card"><h4>Schedule reports</h4><p class="muted">Generate the configuration and workflow for recurring profiling and email delivery.</p></div>', unsafe_allow_html=True)

with tab_profile:
    st.header("Profile dataset")
    uploaded = st.file_uploader("Upload CSV, Excel, or Parquet", type=["csv", "xlsx", "xls", "parquet"])
    if uploaded:
        size_mb = uploaded.size / 1_000_000
        if size_mb > MAX_UPLOAD_MB:
            st.error(f"This file is {size_mb:.1f} MB. The hosted edition currently accepts files up to {MAX_UPLOAD_MB} MB.")
        else:
            try:
                df = read_uploaded_file(uploaded)
                st.session_state["profile_df"] = df
                st.session_state["profile_name"] = uploaded.name
                st.session_state["profile_size_mb"] = size_mb
                st.session_state["ai_summary"] = None
            except Exception as exc:
                st.error(f"Could not read {uploaded.name}: {exc}")

    df = st.session_state["profile_df"]
    source_name = st.session_state["profile_name"]
    if not isinstance(df, pd.DataFrame):
        st.info("Upload a dataset to begin.")
    else:
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Rows", f"{len(df):,}")
        c2.metric("Columns", f"{df.shape[1]:,}")
        c3.metric("Duplicate rows", f"{df.duplicated().sum():,}")
        c4.metric("Missing cells", f"{int(df.isna().sum().sum()):,}")
        c5.metric("File size", f"{st.session_state['profile_size_mb']:.1f} MB")

        basic_tab, advanced_tab, corr_tab, preview_tab = st.tabs(["Basic profile", "Advanced profile", "Correlation", "Preview"])
        with basic_tab:
            st.dataframe(basic_profile(df), use_container_width=True, hide_index=True)
        with advanced_tab:
            st.dataframe(advanced_profile(df), use_container_width=True, hide_index=True)
        with corr_tab:
            corr = correlation_matrix(df)
            if corr is None:
                st.info("A correlation matrix requires at least two numeric columns.")
            else:
                st.dataframe(corr, use_container_width=True, hide_index=True)
        with preview_tab:
            st.caption("The preview is not sent to Gemini.")
            st.dataframe(df.head(MAX_PREVIEW_ROWS), use_container_width=True)

        try:
            st.download_button(
                "Download Excel profiling report",
                data=report_bytes(df, source_name),
                file_name=f"{clean_name(source_name)}_profiling_report.xlsx",
                mime=REPORT_MIME,
                type="primary",
            )
        except Exception as exc:
            st.error(f"Could not create the report: {exc}")

with tab_ai:
    st.header("AI explanation")
    df = st.session_state["profile_df"]
    if not isinstance(df, pd.DataFrame):
        st.info("Profile a dataset first.")
    else:
        st.caption("Enter your Gemini API key in the masked field. This is your Gemini credential, not a password for this app. The key is not written to disk by the application.")
        api_key = st.text_input("Gemini API key", type="password", key="gemini_api_key")
        model = st.text_input("Gemini model", value="gemini-2.5-flash")
        if st.button("Generate AI explanation", type="primary"):
            if not api_key.strip():
                st.error("Enter your Gemini API key first.")
            else:
                try:
                    payload = build_ai_payload(df, st.session_state["profile_name"])
                    with st.spinner("Generating explanation…"):
                        st.session_state["ai_summary"] = generate_gemini_summary(api_key.strip(), payload, model.strip())
                except Exception as exc:
                    st.error(f"Gemini could not generate the explanation: {exc}")
        if st.session_state["ai_summary"]:
            st.markdown(st.session_state["ai_summary"])
            st.download_button("Download AI explanation", st.session_state["ai_summary"], "ai_explanation.txt", "text/plain")
        with st.expander("See exactly what is sent to Gemini"):
            st.json(build_ai_payload(df, st.session_state["profile_name"]))

with tab_schedule:
    st.header("Scheduling & email")
    st.caption("Configure recurring profiling and report delivery, then download the files needed by your local scheduler or GitHub Actions.")
    st.warning(
        "The public Streamlit site cannot keep a browser upload after you leave. For recurring jobs, the scheduled runner needs a durable file path or URL. "
        "Use the local manager for private files, or a runner that can access the source."
    )
    with st.form("schedule_form"):
        dataset = st.text_input("Dataset name", value=clean_name(st.session_state["profile_name"] or "") if st.session_state["profile_name"] else "")
        source = st.text_input("Dataset file path or downloadable URL", placeholder="/Users/you/data/customers.csv or https://...")
        recipient_name = st.text_input("Report recipient name")
        recipient_email = st.text_input("Report recipient email")
        cadence = st.selectbox("Cadence", CADENCES)
        col1, col2, col3, col4 = st.columns(4)
        weekday = col1.selectbox("Weekday", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])
        day_of_month = col2.number_input("Day of month", min_value=1, max_value=28, value=1)
        hour_utc = col3.number_input("Hour (UTC)", min_value=0, max_value=23, value=7)
        minute = col4.number_input("Minute", min_value=0, max_value=59, value=15)
        month = st.number_input("Month for yearly schedule", min_value=1, max_value=12, value=1)
        ai_summary_enabled = st.checkbox("Include Gemini explanation when GEMINI_API_KEY is configured", value=True)
        generate = st.form_submit_button("Generate scheduling files")

    if generate:
        if not dataset or not source or not recipient_email:
            st.error("Dataset name, source, and recipient email are required.")
        else:
            config = {
                "dataset": dataset,
                "source": source,
                "recipient_name": recipient_name,
                "recipient_email": recipient_email,
                "cadence": cadence,
                "weekday": weekday,
                "day_of_month": int(day_of_month),
                "month": int(month),
                "hour_utc": int(hour_utc),
                "minute": int(minute),
                "ai_summary": bool(ai_summary_enabled),
            }
            config_csv = config_to_csv(config)
            workflow = build_workflow_yaml(config)
            st.session_state["schedule_config_csv"] = config_csv
            st.session_state["schedule_workflow"] = workflow

    if st.session_state.get("schedule_config_csv"):
        c1, c2 = st.columns(2)
        c1.download_button("Download schedule_config.csv", st.session_state["schedule_config_csv"], "schedule_config.csv", "text/csv")
        c2.download_button("Download GitHub workflow", st.session_state["schedule_workflow"], "scheduled_profiling.yml", "text/yaml")
        with st.expander("Generated workflow preview"):
            st.code(st.session_state["schedule_workflow"], language="yaml")
        st.info("The repository's `monthly_profiling_agent.py` reads this configuration, creates the report, optionally adds a Gemini explanation, and emails the workbook using your SMTP secrets.")

with tab_local:
    st.header("Local manager")
    st.markdown(
        """
The repository now includes **`local_app.py`**, which restores the full local workflow:

- register datasets once using local file paths
- edit or delete saved datasets
- run profiles without browsing for the file again
- retain local report history
- configure schedule and email recipients per dataset
- generate scheduling files
- keep private datasets on your own computer

Run it with:

```bash
streamlit run local_app.py
```

The public hosted app cannot safely provide persistent per-user schedules without accounts, durable storage, and a backend. The local manager is the correct version for private recurring jobs.
        """
    )