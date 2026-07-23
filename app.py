"""Data Profiling Manager — persistent public Streamlit edition."""
import streamlit as st

from hosted_common import PAGES, apply_brand, initialize_workspace
from hosted_dashboard import render_dashboard
from hosted_profile_pages import render_datasets, render_profile
from hosted_analysis_pages import render_ai, render_compare, render_history, render_trends
from hosted_settings_pages import render_scheduling, render_settings

st.set_page_config(page_title="Data Profiling Manager", page_icon="📊", layout="wide")
apply_brand()
workspace, storage_error = initialize_workspace()

if storage_error:
    st.error(f"Browser persistence is unavailable: {storage_error}. Use Settings to download backups during this session.")
if st.session_state.pop("storage_load_error", None):
    st.warning("The browser history could not be read. You can restore a JSON backup from Settings.")

st.session_state.setdefault("page", "Dashboard")
st.session_state.setdefault("nav_page", st.session_state["page"])
nav = st.radio("Navigation", PAGES, horizontal=True, key="nav_page", label_visibility="collapsed")
if nav != st.session_state["page"]:
    st.session_state["page"] = nav
page = st.session_state["page"]

with st.expander("Privacy, persistence, and hosted-app limits", expanded=False):
    st.markdown(
        """
- Raw uploads are processed in the active Streamlit session and are not added to the browser history.
- The browser history stores aggregate profiling snapshots, dataset labels, saved AI explanations, and schedule settings.
- Browser history is private to this browser profile; other visitors cannot browse it through the app.
- Refreshing the page no longer erases saved profiling snapshots.
- Gemini receives aggregate profiling metrics only, not raw rows or sample values.
- Do not upload confidential, regulated, or highly sensitive data to a public hosted instance. Use the local edition for private files.
        """
    )

if page == "Dashboard":
    render_dashboard(workspace)
elif page == "Datasets":
    render_datasets(workspace)
elif page == "Profile":
    render_profile(workspace)
elif page == "History":
    render_history(workspace)
elif page == "Compare":
    render_compare(workspace)
elif page == "Trends":
    render_trends(workspace)
elif page == "AI explanation":
    render_ai(workspace)
elif page == "Scheduling":
    render_scheduling(workspace)
elif page == "Settings":
    render_settings(workspace)
