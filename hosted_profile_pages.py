"""Hosted dataset, profiling, and report-viewer pages."""
from hosted_common import *  # noqa: F401,F403


def _parse_tags(value: str) -> list[str]:
    return sorted({tag.strip() for tag in value.split(",") if tag.strip()}, key=str.casefold)


def render_datasets(workspace: dict[str, Any]) -> None:
    st.header("Datasets")
    st.markdown('<p class="section-intro">A dataset groups repeated profiling runs so history, comparisons, trends, AI explanations, and schedules stay together.</p>', unsafe_allow_html=True)
    datasets = workspace.get("datasets", [])
    if not datasets:
        st.info("No datasets are registered yet. Save the first profile from the Profile page.")
        if st.button("Profile the first dataset", type="primary"):
            set_page("Profile")
            st.rerun()
        return

    rows = []
    for item in datasets:
        runs = dataset_runs(workspace, item["id"])
        latest = runs[-1] if runs else None
        rows.append({
            "Dataset": item.get("name"),
            "Description": item.get("description", ""),
            "Tags": ", ".join(item.get("tags", [])),
            "Owner": item.get("owner", ""),
            "Last source": item.get("source_name", ""),
            "Saved runs": len(runs),
            "Last profiled": latest.get("profiled_at") if latest else "Never",
            "Schedule": item.get("schedule", {}).get("cadence", "Not configured") if item.get("schedule") else "Not configured",
        })
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)

    labels = {f"{item['name']} · {item.get('source_name', '')}": item["id"] for item in datasets}
    chosen = st.selectbox("Manage dataset", list(labels))
    dataset_id = labels[chosen]
    item = next(row for row in datasets if row["id"] == dataset_id)
    with st.form("edit_dataset"):
        new_name = st.text_input("Dataset name", value=item.get("name", ""))
        description = st.text_area("Description", value=item.get("description", ""), height=90)
        tags = st.text_input("Tags (comma-separated)", value=", ".join(item.get("tags", [])))
        owner = st.text_input("Owner", value=item.get("owner", ""))
        save = st.form_submit_button("Save details", type="primary")
    if save:
        clean_name = new_name.strip()
        duplicate = next((row for row in datasets if row["id"] != dataset_id and str(row.get("name", "")).casefold() == clean_name.casefold()), None)
        if not clean_name:
            st.error("Dataset name is required.")
        elif duplicate:
            st.error("Another dataset already uses that name.")
        else:
            item["name"] = clean_name
            item["description"] = description.strip()
            item["tags"] = _parse_tags(tags)
            item["owner"] = owner.strip()
            for run in workspace.get("runs", []):
                if run.get("dataset_id") == dataset_id:
                    run["dataset_name"] = clean_name
                    run["owner"] = owner.strip()
            persist_workspace(workspace)
            st.success("Dataset details saved.")
            st.rerun()

    confirm = st.checkbox("Also delete every browser-saved run and AI explanation for this dataset", key=f"delete_confirm_{dataset_id}")
    if st.button("Delete selected dataset", disabled=not confirm):
        workspace["datasets"] = [row for row in datasets if row.get("id") != dataset_id]
        workspace["runs"] = [run for run in workspace.get("runs", []) if run.get("dataset_id") != dataset_id]
        workspace["failures"] = [failure for failure in workspace.get("failures", []) if failure.get("dataset_id") != dataset_id]
        if st.session_state.get("current_run_id") and not find_run(workspace, st.session_state["current_run_id"]):
            st.session_state["current_run_id"] = None
        persist_workspace(workspace)
        st.success("Dataset and its browser-saved history were deleted.")
        st.rerun()


def render_profile(workspace: dict[str, Any]) -> None:
    st.header("Profile a dataset")
    st.markdown('<p class="section-intro">Upload CSV, Excel, or Parquet. Save the result as a historical run, or use ad hoc mode for a one-time profile.</p>', unsafe_allow_html=True)
    datasets = workspace.get("datasets", [])
    mode_options = ["New dataset"] + [item["name"] for item in datasets]
    choice = st.selectbox("Profile under", mode_options)
    existing = next((item for item in datasets if item.get("name") == choice), None)
    uploaded = st.file_uploader("Upload a file", type=["csv", "xlsx", "xls", "parquet"], help=f"Hosted upload limit: {MAX_UPLOAD_MB} MB")
    default_name = existing.get("name", "") if existing else (Path(uploaded.name).stem if uploaded else "")

    with st.form("profile_form"):
        save_history = st.checkbox("Save this dataset and profiling run in this browser", value=True)
        dataset_name = st.text_input("Dataset name", value=default_name)
        description = st.text_area("Description (optional)", value=existing.get("description", "") if existing else "", height=80)
        tags = st.text_input("Tags (optional, comma-separated)", value=", ".join(existing.get("tags", [])) if existing else "")
        owner = st.text_input("Owner (optional)", value=existing.get("owner", "") if existing else "")
        submit = st.form_submit_button("Run profiling", type="primary")

    if submit:
        source_name = uploaded.name if uploaded else "No file selected"
        dataset_id = existing.get("id") if existing else None
        if not uploaded:
            st.error("Upload a file first.")
            return
        if uploaded.size / 1_000_000 > MAX_UPLOAD_MB:
            st.error(f"This file is {uploaded.size / 1_000_000:.1f} MB. The hosted limit is {MAX_UPLOAD_MB} MB.")
            return
        if save_history and not dataset_name.strip():
            st.error("Enter a dataset name before saving the run.")
            return
        try:
            with st.spinner("Reading, profiling, and creating the report…"):
                df = read_uploaded_file(uploaded)
                if df.shape[1] == 0:
                    raise ValueError("The file does not contain any readable columns.")
                if save_history:
                    name_match = next((item for item in datasets if str(item.get("name", "")).casefold() == dataset_name.strip().casefold()), None)
                    matched = existing or name_match
                    dataset_id = matched["id"] if matched else unique_dataset_id(workspace, dataset_name)
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
                        description=description.strip(),
                        tags=_parse_tags(tags),
                    )
                    add_snapshot(workspace, snapshot)
                    persist_workspace(workspace)
                    st.session_state["current_run_id"] = snapshot["run_id"]
                    st.session_state.pop("adhoc_snapshot", None)
                else:
                    snapshot = create_snapshot(
                        df,
                        dataset_id="adhoc",
                        dataset_name=dataset_name.strip() or Path(uploaded.name).stem,
                        source_name=uploaded.name,
                        owner=owner.strip(),
                    )
                    st.session_state["adhoc_snapshot"] = snapshot
                    st.session_state["current_run_id"] = None
                st.session_state["active_df"] = df
                st.session_state["active_df_run_id"] = snapshot["run_id"]
                st.session_state["active_report_bytes"] = report_bytes(df, uploaded.name)
            set_page("Report viewer")
            st.rerun()
        except Exception as exc:
            message = str(exc) or exc.__class__.__name__
            if save_history:
                add_failure(
                    workspace,
                    dataset_name=dataset_name.strip() or Path(source_name).stem,
                    source_name=source_name,
                    error_message=message,
                    dataset_id=dataset_id,
                )
                try:
                    persist_workspace(workspace)
                except Exception:
                    pass
            st.error(f"Profiling could not be completed: {message}")

    if st.session_state.get("active_df_run_id") and isinstance(st.session_state.get("active_df"), pd.DataFrame):
        with st.expander("Current-session data preview", expanded=False):
            st.caption("The preview is not saved in browser history or sent to Gemini.")
            st.dataframe(st.session_state["active_df"].head(50), use_container_width=True, hide_index=True)


def render_report_viewer(workspace: dict[str, Any]) -> None:
    st.header("Report viewer")
    saved_runs = sorted(successful_runs(workspace), key=lambda item: item.get("profiled_at", ""), reverse=True)
    adhoc = st.session_state.get("adhoc_snapshot")
    options: dict[str, dict[str, Any]] = {}
    if adhoc:
        options[f"Ad hoc · {run_label(adhoc)}"] = adhoc
    for run in saved_runs:
        options[f"{run.get('dataset_name')} · {run_label(run)}"] = run
    if not options:
        st.info("No profiling report is available yet. Run a profile first.")
        if st.button("Profile a dataset", type="primary"):
            set_page("Profile")
            st.rerun()
        return

    current_id = st.session_state.get("current_run_id") or (adhoc.get("run_id") if adhoc else None)
    labels = list(options)
    default_index = next((index for index, label in enumerate(labels) if options[label].get("run_id") == current_id), 0)
    chosen = st.selectbox("Report", labels, index=default_index)
    run = options[chosen]
    if run.get("dataset_id") != "adhoc":
        st.session_state["current_run_id"] = run["run_id"]

    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Rows", f"{int(run.get('rows', 0)):,}")
    m2.metric("Columns", f"{int(run.get('columns', 0)):,}")
    m3.metric("Duplicate rows", f"{int(run.get('duplicate_rows', 0)):,}")
    m4.metric("Missing cells", f"{int(run.get('missing_cells', 0)):,}")
    m5.metric("Overall missing", f"{float(run.get('overall_missing_percent', 0)):.2f}%")
    st.caption(f"Source: {run.get('source_name', '')} · Profiled: {run.get('profiled_at', '')}")

    basic = pd.DataFrame(run.get("basic_profile", []))
    advanced = pd.DataFrame(run.get("advanced_profile", []))
    correlation = pd.DataFrame(run.get("correlation_profile", []))
    tabs = st.tabs(["Overview", "Basic profile", "Advanced profile", "Profiling summary", "Correlation", "AI explanation", "Download"])
    with tabs[0]:
        overview = pd.DataFrame([
            {"Metric": "Dataset", "Value": run.get("dataset_name")},
            {"Metric": "Owner", "Value": run.get("owner") or "Not specified"},
            {"Metric": "Rows", "Value": run.get("rows")},
            {"Metric": "Columns", "Value": run.get("columns")},
            {"Metric": "Numeric columns", "Value": run.get("numeric_columns")},
            {"Metric": "Other columns", "Value": run.get("categorical_columns")},
            {"Metric": "Memory MB", "Value": run.get("memory_mb")},
            {"Metric": "Duplicate rows", "Value": run.get("duplicate_rows")},
            {"Metric": "Missing cells", "Value": run.get("missing_cells")},
            {"Metric": "Overall missing %", "Value": run.get("overall_missing_percent")},
        ])
        st.dataframe(overview, use_container_width=True, hide_index=True)
        if run.get("column_renames"):
            st.warning("Blank or duplicate column names were made unique for profiling.")
            st.dataframe(pd.DataFrame(run["column_renames"]), use_container_width=True, hide_index=True)
    with tabs[1]:
        st.dataframe(basic, use_container_width=True, hide_index=True)
    with tabs[2]:
        st.dataframe(advanced, use_container_width=True, hide_index=True)
    with tabs[3]:
        if basic.empty:
            st.info("No column-level summary is available.")
        else:
            summary = basic[[column for column in ["Column", "Dtype", "Missing", "Missing %", "Unique", "Unique %"] if column in basic.columns]].copy()
            if not advanced.empty:
                summary = summary.merge(advanced[[column for column in ["Column", "Outlier Count (IQR)", "Key Candidate Flag", "Dominant Pattern %"] if column in advanced.columns]], on="Column", how="left")
            st.dataframe(summary, use_container_width=True, hide_index=True)
    with tabs[4]:
        if correlation.empty:
            st.info("Correlation requires at least two numeric columns. Older snapshots created before correlation persistence may also be blank here.")
        else:
            st.dataframe(correlation, use_container_width=True, hide_index=True)
    with tabs[5]:
        if run.get("ai_summary"):
            st.markdown(run["ai_summary"])
        else:
            st.info("No Gemini explanation is saved for this run. The deterministic report is complete without AI.")
            if run.get("dataset_id") != "adhoc" and st.button("Explain this saved run with Gemini"):
                st.session_state["current_run_id"] = run["run_id"]
                set_page("AI explanation")
                st.rerun()
    with tabs[6]:
        if st.session_state.get("active_df_run_id") == run.get("run_id") and st.session_state.get("active_report_bytes"):
            st.download_button("Download full Excel report", st.session_state["active_report_bytes"], f"{clean_filename(run.get('dataset_name', 'dataset'))}_profiling_report.xlsx", REPORT_MIME, type="primary")
        st.download_button("Download saved snapshot report", snapshot_report_bytes(run), f"{clean_filename(run.get('dataset_name', 'dataset'))}_{str(run.get('run_id', ''))[:8]}_snapshot.xlsx", REPORT_MIME)
