"""Hosted scheduling and settings pages."""
from hosted_common import *  # noqa: F401,F403


def render_scheduling(workspace: dict[str, Any]) -> None:
    st.header("Scheduling & email")
    st.warning("A browser upload cannot be reused after the session ends. Scheduled runners need a durable local path or downloadable URL. Private laptop files should use the local edition and a local scheduler.")
    if st.session_state.pop("schedule_saved_notice", False):
        st.success("Schedule settings saved in this browser.")
    datasets = workspace.get("datasets", [])
    if not datasets:
        st.info("Save a dataset profile first.")
        return
    labels = {item["name"]: item["id"] for item in datasets}
    chosen = st.selectbox("Dataset", list(labels))
    item = next(row for row in datasets if row["id"] == labels[chosen])
    existing = item.get("schedule", {})
    weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    with st.form("schedule_form"):
        source = st.text_input("Durable file path or downloadable URL", value=existing.get("source", ""), placeholder="/Users/you/data/customers.csv or https://...")
        recipient_name = st.text_input("Report recipient name", value=existing.get("recipient_name", item.get("owner", "")))
        recipient_email = st.text_input("Report recipient email", value=existing.get("recipient_email", ""))
        cadence = st.selectbox("Cadence", CADENCES, index=CADENCES.index(existing.get("cadence", "Monthly")) if existing.get("cadence") in CADENCES else 1)
        c1, c2, c3, c4 = st.columns(4)
        weekday = c1.selectbox("Weekday", weekdays, index=weekdays.index(existing.get("weekday", "Monday")))
        day_of_month = c2.number_input("Day of month", 1, 28, int(existing.get("day_of_month", 1)))
        hour_utc = c3.number_input("Hour (UTC)", 0, 23, int(existing.get("hour_utc", 7)))
        minute = c4.number_input("Minute", 0, 59, int(existing.get("minute", 0)))
        month = st.number_input("Month for yearly schedule", 1, 12, int(existing.get("month", 1)))
        ai_summary = st.checkbox("Include Gemini explanation when GEMINI_API_KEY is configured", value=bool(existing.get("ai_summary", True)))
        save = st.form_submit_button("Save schedule", type="primary")
    if save:
        if not source.strip() or not recipient_email.strip():
            st.error("A durable source and recipient email are required.")
        else:
            config = {
                "dataset_id": item["id"],
                "dataset": item["name"],
                "source": source.strip(),
                "recipient_name": recipient_name.strip(),
                "recipient_email": recipient_email.strip(),
                "cadence": cadence,
                "weekday": weekday,
                "day_of_month": int(day_of_month),
                "month": int(month),
                "hour_utc": int(hour_utc),
                "minute": int(minute),
                "ai_summary": bool(ai_summary),
            }
            item["schedule"] = config
            st.session_state["schedule_saved_notice"] = True
            persist_workspace(workspace)
            st.rerun()

    configured = [row.get("schedule") for row in datasets if row.get("schedule")]
    if configured:
        st.subheader("Configured schedules")
        st.dataframe(pd.DataFrame([
            {
                "Dataset": config.get("dataset"),
                "Recipient": config.get("recipient_email"),
                "Cadence": config.get("cadence"),
                "Cron (UTC)": cadence_to_cron(config),
                "Gemini explanation": "Yes" if config.get("ai_summary") else "No",
                "Source": config.get("source"),
            }
            for config in configured
        ]), use_container_width=True, hide_index=True)
        combined_csv = configs_to_csv(configured)
        workflow = build_workflow_yaml_for_crons([cadence_to_cron(config) for config in configured])
        a, b = st.columns(2)
        a.download_button("Download all schedule settings", combined_csv, "schedule_config.csv", "text/csv", use_container_width=True)
        b.download_button("Download combined GitHub workflow", workflow, "scheduled_profiling.yml", "text/yaml", use_container_width=True)
        st.markdown("The runner uses `monthly_profiling_agent.py` to profile each matching source, optionally generate a Gemini summary, email the workbook, write `run_log.jsonl`, and create `profiling_history.jsonl` snapshots that can be imported below.")


def render_settings(workspace: dict[str, Any]) -> None:
    st.header("Settings & backup")
    st.subheader("Browser persistence")
    st.write("Dataset records and aggregate profiling snapshots are saved in this browser's local storage. They survive refreshes and new sessions in this browser, but do not automatically sync to another browser or device.")
    st.caption("The app retains up to 30 runs per dataset and 150 runs total, trimming the oldest runs if browser data approaches 4 MB.")
    st.write(f"Saved datasets: **{len(workspace.get('datasets', []))}** · Saved runs: **{len(workspace.get('runs', []))}**")
    backup = json.dumps(workspace, indent=2, ensure_ascii=False)
    st.download_button("Download browser-data backup", backup, "data_profiling_manager_backup.json", "application/json", type="primary")
    uploaded = st.file_uploader("Restore a browser-data backup", type=["json"], key="browser_data_restore")
    if uploaded and st.button("Import this backup"):
        try:
            restored = workspace_from_json(uploaded.getvalue().decode("utf-8"))
            persist_workspace(restored)
            st.session_state["current_run_id"] = None
            st.session_state["restore_notice"] = True
            st.rerun()
        except Exception as exc:
            st.error(f"Could not import this backup: {exc}")
    if st.session_state.pop("restore_notice", False):
        st.success("Browser history restored.")

    st.divider()
    st.subheader("Import scheduled profiling history")
    st.write("The scheduled runner creates `profiling_history.jsonl`. Import it here to add those runs to History, Compare, and Trends in this browser.")
    scheduled_file = st.file_uploader("Choose profiling_history.jsonl", type=["jsonl", "txt"], key="scheduled_history_import")
    if scheduled_file and st.button("Import scheduled runs"):
        try:
            imported = 0
            existing_ids = {run.get("run_id") for run in workspace.get("runs", [])}
            for line in scheduled_file.getvalue().decode("utf-8").splitlines():
                if not line.strip():
                    continue
                run = json.loads(line)
                if not isinstance(run, dict) or not run.get("run_id") or run.get("run_id") in existing_ids:
                    continue
                if not run.get("basic_profile") or not run.get("schema"):
                    continue
                upsert_dataset(
                    workspace,
                    dataset_id=run.get("dataset_id") or clean_id(str(run.get("dataset_name", "dataset"))),
                    dataset_name=str(run.get("dataset_name", "Dataset")),
                    source_name=str(run.get("source_name", "scheduled source")),
                    owner=str(run.get("owner", "")),
                )
                add_snapshot(workspace, run)
                existing_ids.add(run["run_id"])
                imported += 1
            if not imported:
                st.warning("No new compatible profiling snapshots were found in that file.")
            else:
                persist_workspace(workspace)
                st.session_state["scheduled_import_notice"] = imported
                st.rerun()
        except Exception as exc:
            st.error(f"Could not import scheduled history: {exc}")
    imported_notice = st.session_state.pop("scheduled_import_notice", None)
    if imported_notice:
        st.success(f"Imported {imported_notice} scheduled profiling run(s).")

    st.divider()
    st.subheader("Clear browser data")
    confirm = st.checkbox("I understand this deletes all browser-saved datasets, runs, AI explanations, and schedule settings.")
    if st.button("Clear all browser-saved data", disabled=not confirm):
        clear_workspace()
        st.session_state["clear_notice"] = True
        st.rerun()
    if st.session_state.pop("clear_notice", False):
        st.success("Browser history cleared.")
