"""Full local Data Profiling Manager.

Run with: streamlit run local_app.py
"""
import streamlit as st

from local_common import PAGES, apply_brand, ensure_dirs, load_failures, load_history, load_registry, render_footer
from local_pages import render_page

st.set_page_config(page_title="Data Profiling Manager — Local", page_icon="📊", layout="wide")
ensure_dirs()
apply_brand()
registry = load_registry()
history = load_history()
failures = load_failures()

requested_page = st.session_state.pop("_requested_page", None)
if requested_page in PAGES:
    st.session_state["page"] = requested_page
    st.session_state["nav_page"] = requested_page
st.session_state.setdefault("page", "Dashboard")
st.session_state.setdefault("nav_page", st.session_state["page"])
with st.sidebar:
    st.markdown("### Navigation")
    page = st.radio("Navigation", PAGES, key="nav_page", label_visibility="collapsed")
    st.divider()
    st.caption("Local edition: dataset paths, reports, history, and settings stay on this computer.")
st.session_state["page"] = page
render_page(page, registry, history, failures)
render_footer()
