"""Hosted dashboard page."""
from hosted_common import *  # noqa: F401,F403


def render_dashboard(workspace: dict[str, Any]) -> None:
    runs = successful_runs(workspace)
    datasets = workspace.get("datasets", [])
    scheduled = [item for item in datasets if item.get("schedule")]
    failures = workspace.get("failures", [])

    st.header("Dashboard")
    g1, g2, g3, g4 = st.columns(4)
    g1.metric("Registered datasets", len(datasets))
    g2.metric("Successful profiling runs", len(runs))
    g3.metric("Scheduled datasets", len(scheduled))
    g4.metric("Failed runs", len(failures))

    if not runs:
        st.info("No successful profiling runs are saved yet. Profile a CSV, Excel, or Parquet file to build the dashboard.")
        a, b = st.columns(2)
        if a.button("Profile a dataset", type="primary", use_container_width=True):
            set_page("Profile")
            st.rerun()
        if b.button("Review registered datasets", use_container_width=True):
            set_page("Datasets")
            st.rerun()
        alerts = monitor_alerts(workspace)
        if alerts:
            st.subheader("Profiling Agent recommendations")
            st.dataframe(pd.DataFrame(alerts), use_container_width=True, hide_index=True)
        return

    run = selected_run(workspace)
    if not run:
        return
    dataset_options = {item["name"]: item["id"] for item in datasets if dataset_runs(workspace, item["id"])}
    selected_dataset_name = next((name for name, dataset_id in dataset_options.items() if dataset_id == run.get("dataset_id")), next(iter(dataset_options)))
    left_filter, right_filter = st.columns([1, 2])
    chosen_dataset = left_filter.selectbox("Dataset", list(dataset_options), index=list(dataset_options).index(selected_dataset_name))
    all_dataset_runs = dataset_runs(workspace, dataset_options[chosen_dataset])
    run_options = {run_label(item): item["run_id"] for item in reversed(all_dataset_runs)}
    selected_label = next((label for label, run_id in run_options.items() if run_id == run.get("run_id")), next(iter(run_options)))
    chosen_label = right_filter.selectbox("Saved run", list(run_options), index=list(run_options).index(selected_label))
    if run_options[chosen_label] != run.get("run_id"):
        st.session_state["current_run_id"] = run_options[chosen_label]
        st.rerun()
    run = find_run(workspace, run_options[chosen_label]) or run

    dataset_record = next((item for item in datasets if item.get("id") == run.get("dataset_id")), {})
    meta_parts = [
        html.escape(str(run.get("source_name", ""))),
        html.escape(f"run {str(run.get('profiled_at', '')).replace('T', ' ')}"),
    ]
    if run.get("owner"):
        meta_parts.append(html.escape(f"Owner: {run['owner']}"))
    st.markdown(
        f'<div class="dashboard-banner"><div><div class="dashboard-title">{html.escape(str(run.get("dataset_name", "Dataset")))} profiling dashboard</div><div class="dashboard-meta">{" &nbsp;·&nbsp; ".join(meta_parts)}</div></div><div class="run-badge">{len(all_dataset_runs)} saved run{"s" if len(all_dataset_runs) != 1 else ""}</div></div>',
        unsafe_allow_html=True,
    )

    previous = None
    current_index = next((index for index, item in enumerate(all_dataset_runs) if item.get("run_id") == run.get("run_id")), -1)
    if current_index > 0:
        previous = all_dataset_runs[current_index - 1]

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Total rows", f"{int(run.get('rows', 0)):,}", delta=f"{int(run.get('rows', 0)) - int(previous.get('rows', 0)):+,}" if previous else None)
    m2.metric("Columns", f"{int(run.get('columns', 0)):,}", delta=f"{int(run.get('columns', 0)) - int(previous.get('columns', 0)):+,}" if previous else None)
    m3.metric("Overall missing", f"{float(run.get('overall_missing_percent', 0)):.2f}%", delta=f"{float(run.get('overall_missing_percent', 0)) - float(previous.get('overall_missing_percent', 0)):+.2f} points" if previous else None)
    m4.metric("Duplicate rows", f"{int(run.get('duplicate_rows', 0)):,}", delta=f"{int(run.get('duplicate_rows', 0)) - int(previous.get('duplicate_rows', 0)):+,}" if previous else None)

    missing_df = pd.DataFrame(run.get("basic_profile", []))
    advanced_df = pd.DataFrame(run.get("advanced_profile", []))
    left, right = st.columns(2)
    with left:
        with st.container(border=True):
            st.subheader("Missing % by column")
            if missing_df.empty:
                st.info("No column profile is available.")
            else:
                missing_df["Missing %"] = pd.to_numeric(missing_df["Missing %"], errors="coerce").fillna(0)
                chart_data = missing_df.sort_values("Missing %", ascending=False).head(15)
                chart = alt.Chart(chart_data).mark_bar(cornerRadiusEnd=5, color="#6C72CB").encode(
                    x=alt.X("Missing %:Q", title=None, scale=alt.Scale(domain=[0, 100])),
                    y=alt.Y("Column:N", sort="-x", title=None),
                    tooltip=["Column", "Missing", "Missing %"],
                ).properties(height=max(260, len(chart_data) * 28))
                st.altair_chart(chart, use_container_width=True)
    with right:
        with st.container(border=True):
            st.subheader("Outlier count by column (IQR)")
            if advanced_df.empty:
                st.info("No advanced profile is available.")
            else:
                advanced_df["Outlier Count (IQR)"] = pd.to_numeric(advanced_df["Outlier Count (IQR)"], errors="coerce").fillna(0)
                outlier_data = advanced_df[advanced_df["Outlier Count (IQR)"] > 0].sort_values("Outlier Count (IQR)", ascending=False).head(12)
                if outlier_data.empty:
                    st.info("No IQR outliers were detected in numeric columns.")
                else:
                    chart = alt.Chart(outlier_data).mark_bar(cornerRadiusTopLeft=5, cornerRadiusTopRight=5, color="#6C72CB").encode(
                        x=alt.X("Column:N", sort="-y", title=None, axis=alt.Axis(labelAngle=-25)),
                        y=alt.Y("Outlier Count (IQR):Q", title=None),
                        tooltip=["Column", "Outlier Count (IQR)", "Skewness"],
                    ).properties(height=310)
                    st.altair_chart(chart, use_container_width=True)

    if run.get("ai_summary"):
        st.markdown('<div class="ai-panel"><strong>Gemini explanation saved with this run</strong></div>', unsafe_allow_html=True)
        st.markdown(run["ai_summary"])
    else:
        with st.container(border=True):
            st.subheader("AI explanation")
            st.write("No Gemini explanation is saved for this run. The profiling report is complete without AI.")
            if st.button("Explain this run with Gemini"):
                set_page("AI explanation")
                st.rerun()

    alerts = [alert for alert in monitor_alerts(workspace) if alert.get("Dataset") == dataset_record.get("name")]
    with st.container(border=True):
        st.subheader("Profiling Agent recommendations")
        st.caption("These are factual prompts generated from saved profiling history, not data-quality judgments.")
        if alerts:
            st.dataframe(pd.DataFrame(alerts), use_container_width=True, hide_index=True)
        else:
            st.success("No monitor prompts are currently generated for this dataset.")
        if st.button("Open Monitor"):
            set_page("Monitor")
            st.rerun()

    if previous:
        comparison = compare_runs(previous, run)
        with st.container(border=True):
            st.subheader("What changed since the previous run")
            summary = comparison["summary"]
            columns = st.columns(4)
            columns[0].metric("Rows change", f"{summary['Rows']:+,}")
            columns[1].metric("Columns change", f"{summary['Columns']:+,}")
            columns[2].metric("Duplicate change", f"{summary['Duplicate rows']:+,}")
            columns[3].metric("Missing-cell change", f"{summary['Missing cells']:+,}")
            if comparison["added_columns"]:
                st.write("**Added columns:**", ", ".join(comparison["added_columns"]))
            if comparison["removed_columns"]:
                st.write("**Removed columns:**", ", ".join(comparison["removed_columns"]))
            if st.button("Open full comparison"):
                set_page("Compare")
                st.rerun()

    q1, q2, q3 = st.columns(3)
    if q1.button("Open report viewer", type="primary", use_container_width=True):
        set_page("Report viewer")
        st.rerun()
    if q2.button("View history", use_container_width=True):
        set_page("History")
        st.rerun()
    if q3.button("View trends", use_container_width=True):
        set_page("Trends")
        st.rerun()
