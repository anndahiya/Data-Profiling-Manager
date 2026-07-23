"""Full local Data Profiling Manager.

Run with: streamlit run local_app.py
"""
import streamlit as st

from local_common import PAGES, apply_brand, ensure_dirs, load_history, load_registry
from local_pages import render_page

ensure_dirs()
st.set_page_config(page_title="Data Profiling Manager — Local", page_icon="📊", layout="wide")
apply_brand()
registry = load_registry()
history = load_history()
st.session_state.setdefault("page", "Dashboard")
st.session_state.setdefault("nav_page", st.session_state["page"])
page = st.radio("Navigation", PAGES, horizontal=True, key="nav_page", label_visibility="collapsed")
st.session_state["page"] = page
render_page(page, registry, history)
