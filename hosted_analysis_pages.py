"""Hosted history, compare, trends, and AI pages."""
from hosted_common import *  # noqa: F401,F403


def render_history(workspace: dict[str, Any]) -> None:
    st.header("History")
    runs = sorted(workspace.get("runs", []), key=lambda item: item.get("profiled_at", ""), reverse=True)
    if not runs:
        st.info("No profiling history is saved yet.")
        return
    datasets = workspace.get("datasets", [])
    filter_options = ["All datasets"] + [item["name"] for item in datasets]
    chosen = st.selectbox("Dataset", filter_options)
    if chosen != "All datasets":
        dataset_id = next(item["id"] for item in datasets if item["name"] == chosen)
        runs = [run for run in runs if run.get("dataset_id") == dataset_id]
    table = pd.DataFrame([
        {
            "Dataset": run.get("dataset_name"),
            "Profiled at": run.get("profiled_at"),
            "Source": run.get("source_name"),
            "Rows": run.get("rows"),
            "Columns": run.get("columns"),
            "Duplicate rows": run.get("duplicate_rows"),
            "Missing cells": run.get("missing_cells"),
            "Overall missing %": run.get("overall_missing_percent"),
            "AI explanation": "Yes" if run.get("ai_summary") else "No",
        }
        for run in runs
    ])
    st.dataframe(table, use_container_width=True, hide_index=True)
    labels = {f"{run['dataset_name']} · {run_label(run)}": run["run_id"] for run in runs}
    chosen_run = st.selectbox("Open saved run", list(labels))
    run = find_run(workspace, labels[chosen_run])
    if run:
        c1, c2, c3 = st.columns(3)
        if c1.button("Open on dashboard", type="primary"):
            st.session_state["current_run_id"] = run["run_id"]
            set_page("Dashboard")
            st.rerun()
        c2.download_button("Download snapshot report", snapshot_report_bytes(run), f"{clean_filename(run['dataset_name'])}_{run['run_id'][:8]}.xlsx", REPORT_MIME, use_container_width=True)
        if c3.button("Delete this run", use_container_width=True):
            workspace["runs"] = [item for item in workspace.get("runs", []) if item.get("run_id") != run["run_id"]]
            if st.session_state.get("current_run_id") == run["run_id"]:
                st.session_state["current_run_id"] = None
            persist_workspace(workspace)
            st.success("Saved run deleted.")
            st.rerun()


def render_compare(workspace: dict[str, Any]) -> None:
    st.header("Compare runs")
    eligible = [item for item in workspace.get("datasets", []) if len(dataset_runs(workspace, item["id"])) >= 2]
    if not eligible:
        st.info("Save at least two runs for the same dataset to compare them.")
        return
    labels = {item["name"]: item["id"] for item in eligible}
    dataset_name = st.selectbox("Dataset", list(labels))
    runs = dataset_runs(workspace, labels[dataset_name])
    run_labels = {run_label(run): run for run in reversed(runs)}
    names = list(run_labels)
    c1, c2 = st.columns(2)
    older_label = c1.selectbox("Earlier run", names, index=min(1, len(names) - 1))
    newer_label = c2.selectbox("Later run", names, index=0)
    older, newer = run_labels[older_label], run_labels[newer_label]
    if older.get("profiled_at", "") > newer.get("profiled_at", ""):
        older, newer = newer, older
    if older["run_id"] == newer["run_id"]:
        st.warning("Choose two different runs.")
        return
    result = compare_runs(older, newer)
    summary = result["summary"]
    columns = st.columns(5)
    for column, metric in zip(columns, ["Rows", "Columns", "Duplicate rows", "Missing cells", "Overall missing %"]):
        value = summary[metric]
        suffix = "%" if metric == "Overall missing %" else ""
        column.metric(metric, f"{value:+,.2f}{suffix}" if isinstance(value, float) else f"{value:+,}{suffix}")
    a, b = st.columns(2)
    with a:
        with st.container(border=True):
            st.subheader("Schema changes")
            st.write("**Added:**", ", ".join(result["added_columns"]) or "None")
            st.write("**Removed:**", ", ".join(result["removed_columns"]) or "None")
            if result["dtype_changes"]:
                st.dataframe(pd.DataFrame(result["dtype_changes"]), use_container_width=True, hide_index=True)
            else:
                st.write("No datatype changes.")
    with b:
        with st.container(border=True):
            st.subheader("Run details")
            st.write(f"Earlier: `{older['profiled_at']}`")
            st.write(f"Later: `{newer['profiled_at']}`")
            st.write(f"Source before: `{older.get('source_name', '')}`")
            st.write(f"Source after: `{newer.get('source_name', '')}`")
    st.subheader("Column-level changes")
    if result["column_changes"]:
        changes = pd.DataFrame(result["column_changes"]).sort_values("Missing % change", key=lambda series: series.abs(), ascending=False)
        st.dataframe(changes, use_container_width=True, hide_index=True)
    else:
        st.info("No missing-percentage or unique-count changes were detected in shared columns.")


def render_trends(workspace: dict[str, Any]) -> None:
    st.header("Trends")
    eligible = [item for item in workspace.get("datasets", []) if len(dataset_runs(workspace, item["id"])) >= 2]
    if not eligible:
        st.info("Save at least two runs for the same dataset to view trends.")
        return
    labels = {item["name"]: item["id"] for item in eligible}
    chosen = st.selectbox("Dataset", list(labels))
    frame = trend_frame(dataset_runs(workspace, labels[chosen]))
    metric = st.selectbox("Metric", ["Rows", "Columns", "Duplicate rows", "Missing cells", "Overall missing %", "Memory MB"])
    chart = alt.Chart(frame).mark_line(point=True, strokeWidth=3).encode(
        x=alt.X("Profiled at:T", title=None),
        y=alt.Y(f"{metric}:Q", title=metric, scale=alt.Scale(zero=False)),
        tooltip=[alt.Tooltip("Profiled at:T"), alt.Tooltip(f"{metric}:Q")],
        color=alt.value("#6C72CB"),
    ).properties(height=390)
    st.altair_chart(chart, use_container_width=True)
    st.dataframe(frame, use_container_width=True, hide_index=True)


def render_ai(workspace: dict[str, Any]) -> None:
    st.header("AI explanation")
    run = selected_run(workspace)
    if not run:
        st.info("Save a profiling run first.")
        return
    all_runs = sorted(workspace.get("runs", []), key=lambda item: item.get("profiled_at", ""), reverse=True)
    labels = {f"{item['dataset_name']} · {run_label(item)}": item["run_id"] for item in all_runs}
    current_label = next((label for label, run_id in labels.items() if run_id == run["run_id"]), next(iter(labels)))
    chosen = st.selectbox("Run to explain", list(labels), index=list(labels).index(current_label))
    run = find_run(workspace, labels[chosen])
    if not run:
        return
    st.caption("Gemini is optional. The API key is masked and is not stored in the browser history. Only aggregate profiling metrics are sent.")
    api_key = st.text_input("Gemini API key", type="password")
    model = st.text_input("Gemini model", value="gemini-2.5-flash")
    if st.button("Generate and save explanation", type="primary"):
        if not api_key.strip():
            st.error("Enter a Gemini API key.")
        else:
            try:
                with st.spinner("Generating explanation…"):
                    summary = generate_gemini_summary(api_key.strip(), snapshot_ai_payload(run), model.strip())
                update_ai_summary(workspace, run["run_id"], summary)
                persist_workspace(workspace)
                st.session_state["current_run_id"] = run["run_id"]
                st.success("Explanation saved with this profiling run in your browser history.")
                st.rerun()
            except Exception as exc:
                st.error(f"Gemini could not generate the explanation: {exc}")
    if run.get("ai_summary"):
        st.markdown(run["ai_summary"])
        st.download_button("Download explanation", run["ai_summary"], f"{clean_filename(run['dataset_name'])}_ai_explanation.txt", "text/plain")
    with st.expander("See exactly what is sent to Gemini"):
        st.json(snapshot_ai_payload(run))
