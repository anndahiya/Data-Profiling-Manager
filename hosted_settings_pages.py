"""Hosted scheduling, plugins, and settings pages."""
from hosted_common import *  # noqa: F401,F403


def _valid_email(value: str) -> bool:
    value = value.strip()
    return bool(value and "@" in value and "." in value.rsplit("@", 1)[-1])


def render_scheduling(workspace: dict[str, Any]) -> None:
    st.header("Scheduling & email")
    st.markdown(
        '<p class="section-intro">Save schedule preferences per dataset and export the configuration used by GitHub Actions, cron, or Windows Task Scheduler.</p>',
        unsafe_allow_html=True,
    )
    st.warning(
        "The hosted app cannot reuse a temporary browser upload after the session ends. "
        "A scheduled runner needs a durable downloadable URL or a file path on the computer where the runner executes."
    )
    if st.session_state.pop("schedule_saved_notice", False):
        st.success("Schedule settings saved in this browser.")
    if st.session_state.pop("schedule_deleted_notice", False):
        st.success("Schedule removed from this dataset.")

    datasets = workspace.get("datasets", [])
    if not datasets:
        st.info("Save a dataset profile first, then return here to configure recurring delivery.")
        if st.button("Profile a dataset", type="primary"):
            set_page("Profile")
            st.rerun()
        return

    labels = {f"{item['name']} · {item.get('source_name', '')}": item["id"] for item in datasets}
    chosen = st.selectbox("Dataset", list(labels))
    item = next(row for row in datasets if row["id"] == labels[chosen])
    existing = item.get("schedule") or {}
    weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    with st.form("schedule_form"):
        source = st.text_input(
            "Durable file path or downloadable URL",
            value=existing.get("source", ""),
            placeholder="/Users/you/data/customers.csv or https://example.com/customers.csv",
            help="A GitHub-hosted runner can access a downloadable URL or a file committed to its repository. It cannot access a file stored only on your laptop.",
        )
        recipient_name = st.text_input("Report recipient name", value=existing.get("recipient_name", item.get("owner", "")))
        recipient_email = st.text_input("Report recipient email", value=existing.get("recipient_email", ""))
        cadence = st.selectbox(
            "Cadence",
            CADENCES,
            index=CADENCES.index(existing.get("cadence", "Monthly")) if existing.get("cadence") in CADENCES else 1,
        )
        c1, c2, c3, c4 = st.columns(4)
        weekday_value = existing.get("weekday", "Monday")
        weekday = c1.selectbox("Weekday", weekdays, index=weekdays.index(weekday_value) if weekday_value in weekdays else 0)
        day_of_month = c2.number_input("Day of month", 1, 28, int(existing.get("day_of_month", 1)))
        hour_utc = c3.number_input("Hour (UTC)", 0, 23, int(existing.get("hour_utc", 7)))
        minute = c4.number_input("Minute", 0, 59, int(existing.get("minute", 0)))
        month = st.number_input("Month for yearly schedule", 1, 12, int(existing.get("month", 1)))
        ai_summary = st.checkbox(
            "Include Gemini explanation when GEMINI_API_KEY is configured on the runner",
            value=bool(existing.get("ai_summary", True)),
        )
        save = st.form_submit_button("Save schedule", type="primary")

    if save:
        source_value = source.strip()
        email_value = recipient_email.strip()
        if not source_value:
            st.error("Enter a durable source path or downloadable URL.")
        elif not _valid_email(email_value):
            st.error("Enter a valid report-recipient email address.")
        else:
            config = {
                "dataset_id": item["id"],
                "dataset": item["name"],
                "source": source_value,
                "recipient_name": recipient_name.strip(),
                "recipient_email": email_value,
                "cadence": cadence,
                "weekday": weekday,
                "day_of_month": int(day_of_month),
                "month": int(month),
                "hour_utc": int(hour_utc),
                "minute": int(minute),
                "ai_summary": bool(ai_summary),
            }
            item["schedule"] = config
            try:
                persist_workspace(workspace)
            except Exception as exc:
                item.pop("schedule", None)
                st.error(f"Schedule could not be saved: {exc}")
            else:
                st.session_state["schedule_saved_notice"] = True
                st.rerun()

    if existing and st.button("Remove this dataset's schedule"):
        item.pop("schedule", None)
        try:
            persist_workspace(workspace)
        except Exception as exc:
            item["schedule"] = existing
            st.error(f"Schedule could not be removed: {exc}")
        else:
            st.session_state["schedule_deleted_notice"] = True
            st.rerun()

    configured = [row.get("schedule") for row in datasets if row.get("schedule")]
    if not configured:
        st.info("No recurring schedules are configured yet.")
        return

    st.subheader("Configured schedules")
    st.dataframe(
        pd.DataFrame(
            [
                {
                    "Dataset": config.get("dataset"),
                    "Recipient": config.get("recipient_email"),
                    "Cadence": config.get("cadence"),
                    "Cron (UTC)": cadence_to_cron(config),
                    "Gemini explanation": "Yes" if config.get("ai_summary") else "No",
                    "Source": config.get("source"),
                }
                for config in configured
            ]
        ),
        use_container_width=True,
        hide_index=True,
    )
    combined_csv = configs_to_csv(configured)
    workflow = build_workflow_yaml_for_crons([cadence_to_cron(config) for config in configured])
    a, b = st.columns(2)
    a.download_button(
        "Download schedule_config.csv",
        combined_csv,
        "schedule_config.csv",
        "text/csv",
        use_container_width=True,
    )
    b.download_button(
        "Download GitHub Actions workflow",
        workflow,
        "scheduled_profiling.yml",
        "text/yaml",
        use_container_width=True,
    )

    with st.expander("How automatic email delivery works", expanded=True):
        st.markdown(
            """
1. Download `schedule_config.csv` and the generated workflow.
2. Use a private repository or a trusted local folder because the configuration contains file locations and recipient emails.
3. Keep `monthly_profiling_agent.py`, `data_profiler.py`, `snapshot_manager.py`, `ai_helper.py`, `schedule_helper.py`, and `requirements.txt` beside the configuration.
4. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` as environment variables or GitHub repository secrets.
5. Optionally configure `GEMINI_API_KEY` and `GEMINI_MODEL`.
6. The runner generates the workbook, emails it, records operational results in `run_log.jsonl`, and writes importable snapshots to `profiling_history.jsonl`.

For private files on a personal computer, use the local edition with Windows Task Scheduler or cron. A GitHub-hosted runner cannot read a laptop-only path.
            """
        )


def render_plugins() -> None:
    st.header("Plugins")
    st.markdown(
        '<p class="section-intro">The current release includes file-format support directly. Connector plugins are a documented roadmap, not pretend install buttons.</p>',
        unsafe_allow_html=True,
    )
    built_in = pd.DataFrame(
        [
            {"Connector": "CSV", "Status": "Built in", "Use": "Upload or profile local/downloadable CSV files"},
            {"Connector": "Excel", "Status": "Built in", "Use": "Upload or profile .xlsx and .xls files"},
            {"Connector": "Parquet", "Status": "Built in", "Use": "Upload or profile Parquet files"},
        ]
    )
    st.subheader("Available now")
    st.dataframe(built_in, use_container_width=True, hide_index=True)

    planned = pd.DataFrame(
        [
            {"Connector": "PostgreSQL / SQL Server / MySQL", "Status": "Planned plugin SDK"},
            {"Connector": "Snowflake / BigQuery / Databricks / Fabric", "Status": "Planned plugin SDK"},
            {"Connector": "S3 / Azure Blob / Google Cloud Storage", "Status": "Planned plugin SDK"},
            {"Connector": "REST API / ODBC", "Status": "Planned plugin SDK"},
        ]
    )
    st.subheader("Roadmap")
    st.dataframe(planned, use_container_width=True, hide_index=True)
    st.info("No external connector is claimed as installed in this release. The core application remains usable without plugins.")


def render_settings(workspace: dict[str, Any]) -> None:
    st.header("Settings & backup")
    if st.session_state.pop("restore_notice", False):
        st.success("Browser history restored.")
    imported_notice = st.session_state.pop("scheduled_import_notice", None)
    if imported_notice:
        st.success(f"Imported {imported_notice} scheduled profiling run(s).")
    if st.session_state.pop("clear_notice", False):
        st.success("Browser history cleared.")

    st.subheader("Browser persistence")
    st.write(
        "Dataset records, aggregate profiling snapshots, failure records, saved AI explanations, and schedules are stored in this browser's local storage. "
        "They survive refreshes in this browser but do not automatically sync to another browser, device, private session, or cleared browser profile."
    )
    raw_workspace = workspace_to_json(workspace)
    used_kb = len(raw_workspace.encode("utf-8")) / 1024
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Datasets", len(workspace.get("datasets", [])))
    c2.metric("Successful runs", len(successful_runs(workspace)))
    c3.metric("Failed attempts", len(workspace.get("failures", [])))
    c4.metric("Browser data", f"{used_kb:,.0f} KB")
    st.caption("Retention: up to 30 successful runs per dataset and 150 total, with older runs trimmed as browser data approaches 4 MB.")

    backup = json.dumps(workspace, indent=2, ensure_ascii=False, default=str)
    st.download_button(
        "Download browser-data backup",
        backup,
        "data_profiling_manager_backup.json",
        "application/json",
        type="primary",
    )
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

    st.divider()
    st.subheader("Import scheduled profiling history")
    st.write(
        "The scheduled runner creates `profiling_history.jsonl`. Import it here to add compatible scheduled runs to Datasets, History, Report Viewer, Compare, Trends, and Monitor in this browser."
    )
    scheduled_file = st.file_uploader(
        "Choose profiling_history.jsonl",
        type=["jsonl", "txt"],
        key="scheduled_history_import",
    )
    if scheduled_file and st.button("Import scheduled runs"):
        try:
            imported = 0
            existing_ids = {run.get("run_id") for run in workspace.get("runs", [])}
            for line_number, line in enumerate(scheduled_file.getvalue().decode("utf-8-sig").splitlines(), 1):
                if not line.strip():
                    continue
                run = json.loads(line)
                if not isinstance(run, dict):
                    continue
                run_id = run.get("run_id")
                if not run_id or run_id in existing_ids:
                    continue
                if not run.get("basic_profile") or not run.get("schema") or not run.get("dataset_name"):
                    continue
                dataset_id = run.get("dataset_id") or unique_dataset_id(workspace, str(run.get("dataset_name")))
                run["dataset_id"] = dataset_id
                run.setdefault("status", "success")
                run.setdefault("correlation_profile", [])
                run.setdefault("column_renames", [])
                upsert_dataset(
                    workspace,
                    dataset_id=dataset_id,
                    dataset_name=str(run.get("dataset_name")),
                    source_name=str(run.get("source_name", "scheduled source")),
                    owner=str(run.get("owner", "")),
                )
                add_snapshot(workspace, run)
                existing_ids.add(run_id)
                imported += 1
            if not imported:
                st.warning("No new compatible profiling snapshots were found in that file.")
            else:
                persist_workspace(workspace)
                st.session_state["scheduled_import_notice"] = imported
                st.rerun()
        except UnicodeDecodeError:
            st.error("The scheduled-history file must be UTF-8 text.")
        except json.JSONDecodeError as exc:
            st.error(f"A line in the scheduled-history file is not valid JSON: {exc}")
        except Exception as exc:
            st.error(f"Could not import scheduled history: {exc}")

    st.divider()
    st.subheader("Clear browser data")
    confirm = st.checkbox(
        "I understand this deletes all browser-saved datasets, runs, failures, AI explanations, and schedules."
    )
    if st.button("Clear all browser-saved data", disabled=not confirm):
        clear_workspace()
        st.session_state["clear_notice"] = True
        st.rerun()
