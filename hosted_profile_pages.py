"""Hosted dataset and profiling pages."""
from hosted_common import *  # noqa: F401,F403


def render_datasets(workspace: dict[str, Any]) -> None:
    st.header("Datasets")
    st.markdown('<p class="section-intro">Each uploaded source becomes a reusable dataset record. Profiling snapshots stay separate by dataset.</p>', unsafe_allow_html=True)
    datasets = workspace.get("datasets", [])
    if not datasets:
        st.info("No datasets are registered yet. A dataset is registered automatically when you save its first profile.")
        return
    rows = []
    for item in datasets:
        runs = dataset_runs(workspace, item["id"])
        latest = runs[-1] if runs else None
        rows.append({
            "Dataset": item.get("name"),
            "Owner": item.get("owner", ""),
            "Last source": item.get("source_name", ""),
            "Saved runs": len(runs),
            "Last profiled": latest.get("profiled_at") if latest else None,
            "Rows": latest.get("rows") if latest else None,
            "Schedule": item.get("schedule", {}).get("cadence", "Not configured") if item.get("schedule") else "Not configured",
        })
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

    labels = {item["name"]: item["id"] for item in datasets}
    chosen = st.selectbox("Manage dataset", list(labels))
    dataset_id = labels[chosen]
    item = next(row for row in datasets if row["id"] == dataset_id)
    with st.form("edit_dataset"):
        new_name = st.text_input("Dataset name", value=item.get("name", ""))
        owner = st.text_input("Owner", value=item.get("owner", ""))
        save = st.form_submit_button("Save details")
    if save:
        item["name"] = new_name.strip() or item["name"]
        item["owner"] = owner.strip()
        for run in workspace.get("runs", []):
            if run.get("dataset_id") == dataset_id:
                run["dataset_name"] = item["name"]
                run["owner"] = item["owner"]
        persist_workspace(workspace)
        st.success("Dataset details saved.")
        st.rerun()

    if st.button("Delete dataset and its saved history", type="secondary"):
        workspace["datasets"] = [row for row in datasets if row.get("id") != dataset_id]
        workspace["runs"] = [run for run in workspace.get("runs", []) if run.get("dataset_id") != dataset_id]
        if st.session_state.get("current_run_id") and not find_run(workspace, st.session_state["current_run_id"]):
            st.session_state["current_run_id"] = None
        persist_workspace(workspace)
        st.success("Dataset and its browser-saved profiling history were deleted.")
        st.rerun()


def render_profile(workspace: dict[str, Any]) -> None:
    st.header("Profile a dataset")
    st.markdown('<p class="section-intro">Upload a file, calculate deterministic metrics, and save a new historical run in this browser.</p>', unsafe_allow_html=True)
    datasets = workspace.get("datasets", [])
    mode_options = ["New dataset"] + [item["name"] for item in datasets]
    choice = st.selectbox("Save this run under", mode_options)
    existing = next((item for item in datasets if item.get("name") == choice), None)
    uploaded = st.file_uploader("Upload CSV, Excel, or Parquet", type=["csv", "xlsx", "xls", "parquet"])
    default_name = existing.get("name", "") if existing else (Path(uploaded.name).stem if uploaded else "")
    with st.form("profile_form"):
        dataset_name = st.text_input("Dataset name", value=default_name)
        owner = st.text_input("Owner", value=existing.get("owner", "") if existing else "")
        submit = st.form_submit_button("Run profiling and save", type="primary")
    if submit:
        if not uploaded:
            st.error("Upload a dataset first.")
            return
        if uploaded.size / 1_000_000 > MAX_UPLOAD_MB:
            st.error(f"The public app accepts files up to {MAX_UPLOAD_MB} MB.")
            return
        if not dataset_name.strip():
            st.error("Enter a dataset name.")
            return
        try:
            with st.spinner("Profiling and saving this run…"):
                df = read_uploaded_file(uploaded)
                name_match = next((item for item in datasets if str(item.get("name", "")).casefold() == dataset_name.strip().casefold()), None)
                matched_dataset = existing or name_match
                dataset_id = matched_dataset["id"] if matched_dataset else clean_id(dataset_name)
                snapshot = create_snapshot(
                    df,
                    dataset_id=dataset_id,
                    dataset_name=dataset_name.strip(),
                    source_name=uploaded.name,
                    owner=owner.strip(),
                )
                upsert_dataset(
                    workspace,
                    dataset_id=dataset_id,
                    dataset_name=dataset_name.strip(),
                    source_name=uploaded.name,
                    owner=owner.strip(),
                )
                add_snapshot(workspace, snapshot)
                persist_workspace(workspace)
                st.session_state["current_run_id"] = snapshot["run_id"]
                st.session_state["active_df"] = df
                st.session_state["active_df_run_id"] = snapshot["run_id"]
                st.session_state["active_report_bytes"] = report_bytes(df, uploaded.name)
            set_page("Dashboard")
            st.rerun()
        except Exception as exc:
            st.error(f"Could not profile {uploaded.name}: {exc}")

    run = selected_run(workspace)
    if run:
        st.divider()
        st.subheader("Currently selected saved run")
        st.write(f"**{run['dataset_name']}** · {run['profiled_at']} · {run['rows']:,} rows")
        tabs = st.tabs(["Basic profile", "Advanced profile", "Correlation", "Download"])
        with tabs[0]:
            st.dataframe(pd.DataFrame(run.get("basic_profile", [])), use_container_width=True, hide_index=True)
        with tabs[1]:
            st.dataframe(pd.DataFrame(run.get("advanced_profile", [])), use_container_width=True, hide_index=True)
        with tabs[2]:
            if st.session_state.get("active_df_run_id") == run["run_id"] and isinstance(st.session_state.get("active_df"), pd.DataFrame):
                correlation = correlation_matrix(st.session_state["active_df"])
                if correlation is not None:
                    st.dataframe(correlation, use_container_width=True, hide_index=True)
                else:
                    st.info("At least two numeric columns are required.")
            else:
                st.info("Correlation is displayed during the active upload session. Historical snapshots retain the metrics needed for history, comparison, and trends.")
        with tabs[3]:
            if st.session_state.get("active_df_run_id") == run["run_id"] and st.session_state.get("active_report_bytes"):
                st.download_button("Download full Excel report", st.session_state["active_report_bytes"], f"{clean_filename(run['dataset_name'])}_profiling_report.xlsx", REPORT_MIME, type="primary")
            st.download_button("Download saved snapshot report", snapshot_report_bytes(run), f"{clean_filename(run['dataset_name'])}_{run['run_id'][:8]}_snapshot.xlsx", REPORT_MIME)
