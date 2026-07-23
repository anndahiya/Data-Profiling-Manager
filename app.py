"""Data Profiling Manager — hosted/local Streamlit edition.

Run locally:
    streamlit run app.py

The deterministic profile works without AI. Gemini is optional and receives
only aggregate profiling metrics, never raw dataset rows.
"""
from __future__ import annotations

import re
import tempfile
from pathlib import Path

import pandas as pd
import streamlit as st

from data_profiler import advanced_profile, basic_profile, build_report, correlation_matrix
from ai_helper import build_ai_payload, generate_gemini_summary

REPORT_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_UPLOAD_MB = 50
MAX_PREVIEW_ROWS = 50


def clean_name(name: str) -> str:
    stem = Path(name).stem.lower()
    stem = re.sub(r"[^a-z0-9_]+", "_", stem).strip("_")
    return stem or "dataset"


def read_uploaded_file(uploaded_file) -> pd.DataFrame:
    suffix = Path(uploaded_file.name).suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(uploaded_file)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(uploaded_file)
    if suffix == ".parquet":
        return pd.read_parquet(uploaded_file)
    raise ValueError(f"Unsupported file type: {suffix}")


def profile_to_excel_bytes(df: pd.DataFrame, source_name: str) -> bytes:
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        build_report(df, source_name, str(tmp_path))
        return tmp_path.read_bytes()
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)


st.set_page_config(page_title="Data Profiling Manager", page_icon="📊", layout="wide")
st.title("Data Profiling Manager")
st.caption("Profile a dataset, review the results, and download an Excel report. AI explanation is optional.")

with st.expander("Privacy and processing", expanded=False):
    st.markdown(
        """
- The hosted edition processes uploads temporarily for the current session and does not intentionally save a dataset history.
- Other visitors cannot browse your uploaded file or results through the app.
- Do not upload confidential, regulated, or highly sensitive data to a public hosted instance.
- For Gemini explanations, only aggregate profiling metrics are sent to Gemini—not raw rows or sample values.
- Use the downloadable local edition when the dataset must remain on your computer.
        """
    )

uploaded_file = st.file_uploader(
    "Upload a dataset",
    type=["csv", "xlsx", "xls", "parquet"],
    accept_multiple_files=False,
    help=f"Maximum recommended upload size: {MAX_UPLOAD_MB} MB.",
)

if not uploaded_file:
    st.info("Upload a CSV, Excel, or Parquet file to begin.")
    st.stop()

file_size_mb = uploaded_file.size / 1_000_000
if file_size_mb > MAX_UPLOAD_MB:
    st.error(f"This file is {file_size_mb:.1f} MB. The hosted edition currently accepts files up to {MAX_UPLOAD_MB} MB.")
    st.stop()

try:
    df = read_uploaded_file(uploaded_file)
except Exception as exc:
    st.error(f"Could not read {uploaded_file.name}: {exc}")
    st.stop()

if df.empty and df.shape[1] == 0:
    st.error("The uploaded file does not contain a readable table.")
    st.stop()

c1, c2, c3, c4, c5 = st.columns(5)
c1.metric("Rows", f"{len(df):,}")
c2.metric("Columns", f"{df.shape[1]:,}")
c3.metric("Duplicate rows", f"{df.duplicated().sum():,}")
c4.metric("Missing cells", f"{int(df.isna().sum().sum()):,}")
c5.metric("File size", f"{file_size_mb:.1f} MB")

profile_tab, advanced_tab, corr_tab, ai_tab, download_tab = st.tabs(
    ["Basic profile", "Advanced profile", "Correlation", "AI explanation", "Download report"]
)

bp = basic_profile(df)
ap = advanced_profile(df)
corr = correlation_matrix(df)

with profile_tab:
    with st.expander("Preview data", expanded=False):
        st.caption("Preview is shown only in your current session and is not sent to Gemini.")
        st.dataframe(df.head(MAX_PREVIEW_ROWS), use_container_width=True)
    st.dataframe(bp, use_container_width=True, hide_index=True)

with advanced_tab:
    st.dataframe(ap, use_container_width=True, hide_index=True)

with corr_tab:
    if corr is None:
        st.info("A correlation matrix requires at least two numeric columns.")
    else:
        st.dataframe(corr, use_container_width=True, hide_index=True)

with ai_tab:
    st.markdown("#### Explain the profiling results with Gemini")
    st.caption(
        "AI is optional. Enter your Gemini API key in the masked field below. This is not an app password. "
        "The key is not saved to disk or shared with other users, and only aggregate profiling metrics are sent to Gemini."
    )
    api_key = st.text_input("Gemini API key", type="password", key="gemini_api_key")
    model = st.text_input("Gemini model", value="gemini-2.5-flash", help="Change this only if your API account uses a different model.")

    if st.button("Generate AI explanation", type="primary"):
        if not api_key.strip():
            st.error("Enter your Gemini API key first.")
        else:
            payload = build_ai_payload(df, uploaded_file.name)
            try:
                with st.spinner("Generating explanation…"):
                    summary = generate_gemini_summary(api_key.strip(), payload, model.strip())
                st.session_state["ai_summary"] = summary
            except Exception as exc:
                st.error(f"Gemini could not generate the explanation: {exc}")

    if st.session_state.get("ai_summary"):
        st.markdown(st.session_state["ai_summary"])
        st.download_button(
            "Download AI explanation",
            data=st.session_state["ai_summary"],
            file_name=f"{clean_name(uploaded_file.name)}_ai_explanation.txt",
            mime="text/plain",
        )

    with st.expander("See exactly what is sent to Gemini"):
        st.json(build_ai_payload(df, uploaded_file.name))

with download_tab:
    st.write("The Excel report contains the overview, basic profile, advanced profile, and correlation matrix when available.")
    try:
        report_bytes = profile_to_excel_bytes(df, uploaded_file.name)
        st.download_button(
            "Download Excel profiling report",
            data=report_bytes,
            file_name=f"{clean_name(uploaded_file.name)}_profiling_report.xlsx",
            mime=REPORT_MIME,
            type="primary",
        )
    except Exception as exc:
        st.error(f"Could not create the Excel report: {exc}")
