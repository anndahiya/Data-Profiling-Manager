"""Data Profiling Manager — persistent public Streamlit edition."""
import streamlit as st

from hosted_common import PAGES, apply_brand, initialize_workspace, render_footer
from hosted_dashboard import render_dashboard
from hosted_profile_pages import render_datasets, render_profile, render_report_viewer
from hosted_analysis_pages import render_ai, render_compare, render_history, render_monitor, render_trends
from hosted_settings_pages import render_plugins, render_scheduling, render_settings
from navigation import render_sidebar_menu

st.set_page_config(page_title="Data Profiling Manager", page_icon="📊", layout="wide")
apply_brand()
workspace, storage_error, storage_ready = initialize_workspace()

if storage_error:
    st.error(f"Browser persistence is unavailable: {storage_error}. Download a backup before leaving this session.")
if st.session_state.pop("storage_load_error", False):
    st.warning("The saved browser history could not be read. Restore a JSON backup from Settings.")
if not storage_ready:
    st.info("Loading your saved browser history…")
    st.stop()

requested_page = st.session_state.pop("_requested_page", None)
if requested_page in PAGES:
    st.session_state["page"] = requested_page

st.session_state.setdefault("page", "Dashboard")
page = st.session_state["page"]
render_sidebar_menu(
    PAGES,
    page,
    caption="Saved history belongs to this browser profile. Use Settings to download a backup.",
)

with st.expander("Privacy, persistence, and hosted-app limits", expanded=False):
    st.markdown(
        """
- Raw uploads are processed in the active Streamlit session and are not stored in browser history.
- Browser history stores aggregate profiling snapshots, dataset labels, saved AI explanations, failures, and schedule settings.
- Refreshing the page does not erase saved snapshots in the same browser profile.
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
elif page == "Report viewer":
    render_report_viewer(workspace)
elif page == "History":
    render_history(workspace)
elif page == "Compare":
    render_compare(workspace)
elif page == "Trends":
    render_trends(workspace)
elif page == "Monitor":
    render_monitor(workspace)
elif page == "AI explanation":
    render_ai(workspace)
elif page == "Scheduling":
    render_scheduling(workspace)
elif page == "Plugins":
    render_plugins()
elif page == "Settings":
    render_settings(workspace)

render_footer()
