"""Hosted dashboard page."""
from hosted_common import *  # noqa: F401,F403


def render_dashboard(workspace: dict[str, Any]) -> None:
    run = selected_run(workspace)
    if not run:
        st.header("Dashboard")
        st.info("No profiling runs are saved yet. Use Profile to add the first dataset.")
        if st.button("Profile a dataset", type="primary"):
            set_page("Profile")
            st.rerun()
        return

    all_dataset_runs = dataset_runs(workspace, run["dataset_id"])
    run_options = {run_label(item): item["run_id"] for item in reversed(all_dataset_runs)}
    selected_label = next((label for label, run_id in run_options.items() if run_id == run["run_id"]), next(iter(run_options)))
    chosen_label = st.selectbox("Dashboard run", list(run_options), index=list(run_options).index(selected_label), label_visibility="collapsed")
    if run_options[chosen_label] != run["run_id"]:
        st.session_state["current_run_id"] = run_options[chosen_label]
        st.rerun()

    safe_dataset_name = html.escape(str(run.get("dataset_name", "Dataset")))
    meta_parts = [
        html.escape(str(run.get("source_name", ""))),
        html.escape(f"run {str(run.get('profiled_at', '')).replace('T', ' ')}"),
    ]
    if run.get("owner"):
        meta_parts.append(html.escape(f"Owner: {run['owner']}"))
    st.markdown(
        f'<div class="dashboard-banner"><div><div class="dashboard-title">{safe_dataset_name} profiling dashboard</div><div class="dashboard-meta">{" &nbsp;·&nbsp; ".join(meta_parts)}</div></div><div class="run-badge">Saved run</div></div>',
        unsafe_allow_html=True,
    )

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Total rows", f"{run.get('rows', 0):,}", f"{run.get('duplicate_rows', 0):,} duplicates detected")
    m2.metric("Columns", f"{run.get('columns', 0):,}", f"{run.get('numeric_columns', 0)} numeric · {run.get('categorical_columns', 0)} other")
    missing_columns = sum(1 for row in run.get("basic_profile", []) if float(row.get("Missing %") or 0) > 0)
    m3.metric("Overall missing", f"{float(run.get('overall_missing_percent', 0)):.2f}%", f"{run.get('missing_cells', 0):,} cells across {missing_columns} columns")
    previous = all_dataset_runs[-2] if len(all_dataset_runs) >= 2 and all_dataset_runs[-1]["run_id"] == run["run_id"] else None
    if previous is None:
        index = next((idx for idx, item in enumerate(all_dataset_runs) if item["run_id"] == run["run_id"]), -1)
        previous = all_dataset_runs[index - 1] if index > 0 else None
    delta_text = "First saved run" if not previous else f"{run.get('rows', 0) - previous.get('rows', 0):+,} rows vs previous"
    m4.metric("Saved runs", len(all_dataset_runs), delta_text)

    left, right = st.columns(2)
    missing_df = pd.DataFrame(run.get("basic_profile", []))
    if not missing_df.empty:
        missing_df["Missing %"] = pd.to_numeric(missing_df["Missing %"], errors="coerce").fillna(0)
        missing_chart_data = missing_df.sort_values("Missing %", ascending=False).head(15)
        with left:
            with st.container(border=True):
                st.subheader("Missing % by column")
                chart = alt.Chart(missing_chart_data).mark_bar(cornerRadiusEnd=5).encode(
                    x=alt.X("Missing %:Q", scale=alt.Scale(domain=[0, max(100, float(missing_chart_data["Missing %"].max() or 0))]), title=None),
                    y=alt.Y("Column:N", sort="-x", title=None),
                    color=alt.condition(alt.datum["Missing %"] > 5, alt.value("#E84D4F"), alt.value("#6C72CB")),
                    tooltip=["Column", "Missing", "Missing %"],
                ).properties(height=max(260, len(missing_chart_data) * 28))
                st.altair_chart(chart, use_container_width=True)

    advanced_df = pd.DataFrame(run.get("advanced_profile", []))
    if not advanced_df.empty:
        advanced_df["Outlier Count (IQR)"] = pd.to_numeric(advanced_df["Outlier Count (IQR)"], errors="coerce").fillna(0)
        outlier_data = advanced_df[advanced_df["Outlier Count (IQR)"] > 0].sort_values("Outlier Count (IQR)", ascending=False).head(12)
        with right:
            with st.container(border=True):
                st.subheader("Outlier count by column (IQR)")
                if outlier_data.empty:
                    st.info("No IQR outliers were detected in numeric columns.")
                else:
                    chart = alt.Chart(outlier_data).mark_bar(cornerRadiusTopLeft=5, cornerRadiusTopRight=5).encode(
                        x=alt.X("Column:N", sort="-y", title=None, axis=alt.Axis(labelAngle=-25)),
                        y=alt.Y("Outlier Count (IQR):Q", title=None),
                        color=alt.value("#6C72CB"),
                        tooltip=["Column", "Outlier Count (IQR)", "Skewness"],
                    ).properties(height=310)
                    st.altair_chart(chart, use_container_width=True)

    if run.get("ai_summary"):
        st.markdown('<div class="ai-panel"><strong>Gemini explanation saved with this run</strong></div>', unsafe_allow_html=True)
        st.markdown(run["ai_summary"])
    else:
        with st.container(border=True):
            st.subheader("AI explanation")
            st.write("No Gemini explanation is saved for this run. The deterministic profile is complete without AI.")
            if st.button("Explain this run with Gemini"):
                set_page("AI explanation")
                st.rerun()

    with st.container(border=True):
        st.subheader("Profile observations")
        observations: list[str] = []
        for row in missing_df.sort_values("Missing %", ascending=False).head(5).to_dict("records") if not missing_df.empty else []:
            if float(row.get("Missing %") or 0) > 0:
                observations.append(f"**{row['Column']}** has {row['Missing']:,} missing values ({float(row['Missing %']):.2f}%).")
        for row in advanced_df.sort_values("Outlier Count (IQR)", ascending=False).head(4).to_dict("records") if not advanced_df.empty else []:
            if int(row.get("Outlier Count (IQR)") or 0) > 0:
                observations.append(f"**{row['Column']}** has {int(row['Outlier Count (IQR)']):,} IQR outliers.")
        constants = [row.get("Column") for row in run.get("advanced_profile", []) if row.get("Key Candidate Flag") == "Constant"]
        if constants:
            observations.append(f"Constant columns detected: **{', '.join(map(str, constants))}**.")
        if not observations:
            observations.append("No missing values, IQR outliers, or constant columns were detected in the saved profile.")
        for item in observations[:8]:
            st.markdown(f"- {item}")

    if previous:
        comparison = compare_runs(previous, run)
        with st.container(border=True):
            st.subheader("What changed since the previous saved run")
            summary = comparison["summary"]
            columns = st.columns(4)
            columns[0].metric("Rows", f"{run.get('rows', 0):,}", f"{summary['Rows']:+,}")
            columns[1].metric("Columns", f"{run.get('columns', 0):,}", f"{summary['Columns']:+,}")
            columns[2].metric("Duplicate rows", f"{run.get('duplicate_rows', 0):,}", f"{summary['Duplicate rows']:+,}")
            columns[3].metric("Missing cells", f"{run.get('missing_cells', 0):,}", f"{summary['Missing cells']:+,}")
            if comparison["added_columns"]:
                st.write("Added columns:", ", ".join(comparison["added_columns"]))
            if comparison["removed_columns"]:
                st.write("Removed columns:", ", ".join(comparison["removed_columns"]))
            if st.button("Open full comparison"):
                set_page("Compare")
                st.rerun()
