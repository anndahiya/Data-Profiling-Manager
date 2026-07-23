"""Local manager page renderer."""
from local_common import *  # noqa: F401,F403


def render_page(page: str, registry: list[dict[str, Any]], history: list[dict[str, Any]]) -> None:
    if page == "Dashboard":
        st.header("Dashboard")
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Registered datasets", len(registry))
        c2.metric("Saved runs", len(history))
        c3.metric("Scheduled datasets", sum(1 for item in registry if item.get("schedule")))
        c4.metric("Generated reports", len(list(REPORT_DIR.glob("*.xlsx"))))
        if not history:
            st.info("No profiling runs yet. Register a dataset and run its first profile.")
        else:
            latest = max(history, key=lambda run: run.get("profiled_at", ""))
            st.subheader(f"Latest run · {latest.get('dataset_name', 'Dataset')}")
            a, b, c, d = st.columns(4)
            a.metric("Rows", f"{latest.get('rows', 0):,}")
            b.metric("Columns", f"{latest.get('columns', 0):,}")
            c.metric("Duplicate rows", f"{latest.get('duplicate_rows', 0):,}")
            d.metric("Overall missing", f"{float(latest.get('overall_missing_percent', 0)):.2f}%")
            recent = pd.DataFrame([
                {"Dataset": run.get("dataset_name"), "Profiled at": run.get("profiled_at"), "Rows": run.get("rows"), "Columns": run.get("columns"), "Source": run.get("source_name")}
                for run in sorted(history, key=lambda row: row.get("profiled_at", ""), reverse=True)[:10]
            ])
            st.dataframe(recent, use_container_width=True, hide_index=True)

    elif page == "Datasets":
        st.header("Datasets")
        mode = st.radio("Action", ["Add dataset", "Edit dataset", "Delete dataset"], horizontal=True)
        selected = None
        if mode != "Add dataset" and registry:
            labels = {f"{item['name']} · {item.get('source', '')}": item["id"] for item in registry}
            selected_label = st.selectbox("Dataset", list(labels))
            selected = next(item for item in registry if item["id"] == labels[selected_label])
        if mode == "Delete dataset":
            if not selected:
                st.info("No dataset is available to delete.")
            elif st.button("Delete dataset record"):
                registry = [item for item in registry if item["id"] != selected["id"]]
                save_registry(registry)
                st.success("Dataset record deleted. Existing history and reports were retained.")
                st.rerun()
        else:
            existing = selected or {}
            with st.form("dataset_form"):
                name = st.text_input("Dataset name", value=existing.get("name", ""))
                source = st.text_input("Local file path or downloadable URL", value=existing.get("source", ""))
                owner = st.text_input("Owner", value=existing.get("owner", ""))
                save = st.form_submit_button("Save dataset", type="primary")
            if save:
                if not name.strip() or not source.strip():
                    st.error("Dataset name and source are required.")
                else:
                    item = {
                        "id": existing.get("id") or clean_id(name),
                        "name": name.strip(),
                        "source": source.strip(),
                        "owner": owner.strip(),
                        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        "schedule": existing.get("schedule"),
                    }
                    if selected:
                        selected.update(item)
                    else:
                        item["created_at"] = item["updated_at"]
                        registry.append(item)
                    registry.sort(key=lambda row: row["name"].lower())
                    save_registry(registry)
                    st.success("Dataset saved.")
                    st.rerun()
        if registry:
            st.dataframe(pd.DataFrame(registry), use_container_width=True, hide_index=True)

    elif page == "Run profiling":
        st.header("Run profiling")
        if not registry:
            st.info("Register a dataset first.")
        else:
            labels = {f"{item['name']} · {item['source']}": item for item in registry}
            label = st.selectbox("Dataset", list(labels))
            item = labels[label]
            if st.button("Profile now", type="primary"):
                try:
                    with st.spinner("Profiling dataset…"):
                        run = profile_dataset(item)
                    item["last_profiled"] = run["profiled_at"]
                    item["last_report_path"] = run["report_path"]
                    save_registry(registry)
                    st.session_state["selected_run_id"] = run["run_id"]
                    st.success("Profile completed and saved to history.")
                    st.rerun()
                except Exception as exc:
                    st.error(f"Profiling failed: {exc}")
            selected_id = st.session_state.get("selected_run_id")
            run = find_run({"runs": load_history()}, selected_id) if selected_id else None
            if run:
                st.json({key: run.get(key) for key in ["rows", "columns", "duplicate_rows", "missing_cells", "overall_missing_percent"]})
                report_path = Path(run.get("report_path", ""))
                if report_path.is_file():
                    st.download_button("Download full report", report_path.read_bytes(), report_path.name, REPORT_MIME)

    elif page == "History":
        st.header("History")
        if not history:
            st.info("No profiling history yet.")
        else:
            table = pd.DataFrame([
                {"Dataset": run.get("dataset_name"), "Profiled at": run.get("profiled_at"), "Rows": run.get("rows"), "Columns": run.get("columns"), "Duplicates": run.get("duplicate_rows"), "Missing cells": run.get("missing_cells"), "Source": run.get("source_name")}
                for run in sorted(history, key=lambda row: row.get("profiled_at", ""), reverse=True)
            ])
            st.dataframe(table, use_container_width=True, hide_index=True)
            labels = {f"{run.get('dataset_name')} · {run_label(run)}": run for run in sorted(history, key=lambda row: row.get("profiled_at", ""), reverse=True)}
            run = labels[st.selectbox("Saved run", list(labels))]
            c1, c2 = st.columns(2)
            report_path = Path(run.get("report_path", ""))
            if report_path.is_file():
                c1.download_button("Download full report", report_path.read_bytes(), report_path.name, REPORT_MIME, use_container_width=True)
            c2.download_button("Download snapshot report", snapshot_report_bytes(run), f"{clean_filename(run.get('dataset_name', 'dataset'))}_snapshot.xlsx", REPORT_MIME, use_container_width=True)

    elif page == "Compare":
        st.header("Compare runs")
        eligible = [item for item in registry if len([run for run in history if run.get("dataset_id") == item["id"] and run.get("schema")]) >= 2]
        if not eligible:
            st.info("Save at least two full profiling runs for the same dataset.")
        else:
            labels = {item["name"]: item["id"] for item in eligible}
            dataset_name = st.selectbox("Dataset", list(labels))
            runs = [run for run in dataset_runs({"runs": history}, labels[dataset_name]) if run.get("schema")]
            run_labels = {run_label(run): run for run in reversed(runs)}
            names = list(run_labels)
            a, b = st.columns(2)
            older = run_labels[a.selectbox("Earlier run", names, index=min(1, len(names)-1))]
            newer = run_labels[b.selectbox("Later run", names, index=0)]
            if older["run_id"] == newer["run_id"]:
                st.warning("Choose two different runs.")
            else:
                if older.get("profiled_at", "") > newer.get("profiled_at", ""):
                    older, newer = newer, older
                result = compare_runs(older, newer)
                columns = st.columns(5)
                for column, metric in zip(columns, ["Rows", "Columns", "Duplicate rows", "Missing cells", "Overall missing %"]):
                    value = result["summary"][metric]
                    column.metric(metric, f"{value:+,.2f}" if isinstance(value, float) else f"{value:+,}")
                st.write("Added columns:", ", ".join(result["added_columns"]) or "None")
                st.write("Removed columns:", ", ".join(result["removed_columns"]) or "None")
                if result["dtype_changes"]:
                    st.dataframe(pd.DataFrame(result["dtype_changes"]), use_container_width=True, hide_index=True)
                if result["column_changes"]:
                    st.dataframe(pd.DataFrame(result["column_changes"]), use_container_width=True, hide_index=True)

    elif page == "Trends":
        st.header("Trends")
        eligible = [item for item in registry if len(dataset_runs({"runs": history}, item["id"])) >= 2]
        if not eligible:
            st.info("Save at least two runs for the same dataset.")
        else:
            labels = {item["name"]: item["id"] for item in eligible}
            chosen = st.selectbox("Dataset", list(labels))
            frame = trend_frame(dataset_runs({"runs": history}, labels[chosen]))
            metric = st.selectbox("Metric", ["Rows", "Columns", "Duplicate rows", "Missing cells", "Overall missing %", "Memory MB"])
            chart = alt.Chart(frame).mark_line(point=True, strokeWidth=3).encode(
                x=alt.X("Profiled at:T", title=None), y=alt.Y(f"{metric}:Q", scale=alt.Scale(zero=False)), color=alt.value("#6C72CB"), tooltip=["Profiled at:T", f"{metric}:Q"]
            ).properties(height=390)
            st.altair_chart(chart, use_container_width=True)
            st.dataframe(frame, use_container_width=True, hide_index=True)

    elif page == "AI explanation":
        st.header("AI explanation")
        compatible = [run for run in history if run.get("basic_profile")]
        if not compatible:
            st.info("Save a profiling run first.")
        else:
            labels = {f"{run.get('dataset_name')} · {run_label(run)}": run for run in reversed(compatible)}
            run = labels[st.selectbox("Run", list(labels))]
            api_key = st.text_input("Gemini API key", type="password")
            model = st.text_input("Gemini model", value="gemini-2.5-flash")
            if st.button("Generate and save explanation", type="primary"):
                if not api_key.strip():
                    st.error("Enter a Gemini API key.")
                else:
                    try:
                        summary = generate_gemini_summary(api_key.strip(), snapshot_ai_payload(run), model.strip())
                        for item in history:
                            if item.get("run_id") == run.get("run_id"):
                                item["ai_summary"] = summary
                        save_history(history)
                        st.success("Explanation saved with this run.")
                        st.rerun()
                    except Exception as exc:
                        st.error(f"Gemini could not generate the explanation: {exc}")
            if run.get("ai_summary"):
                st.markdown(run["ai_summary"])

    elif page == "Scheduling":
        st.header("Scheduling & email")
        if not registry:
            st.info("Register a dataset first.")
        else:
            labels = {item["name"]: item for item in registry}
            item = labels[st.selectbox("Dataset", list(labels))]
            existing = item.get("schedule") or {}
            weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            with st.form("schedule_form"):
                recipient_name = st.text_input("Report recipient name", value=existing.get("recipient_name", item.get("owner", "")))
                recipient_email = st.text_input("Report recipient email", value=existing.get("recipient_email", ""))
                cadence = st.selectbox("Cadence", CADENCES, index=CADENCES.index(existing.get("cadence", "Monthly")) if existing.get("cadence") in CADENCES else 1)
                c1, c2, c3, c4 = st.columns(4)
                weekday = c1.selectbox("Weekday", weekdays, index=weekdays.index(existing.get("weekday", "Monday")))
                day = c2.number_input("Day of month", 1, 28, int(existing.get("day_of_month", 1)))
                hour = c3.number_input("Hour (UTC)", 0, 23, int(existing.get("hour_utc", 7)))
                minute = c4.number_input("Minute", 0, 59, int(existing.get("minute", 0)))
                month = st.number_input("Month for yearly", 1, 12, int(existing.get("month", 1)))
                ai_summary = st.checkbox("Include Gemini explanation when configured", value=bool(existing.get("ai_summary", True)))
                save = st.form_submit_button("Save schedule", type="primary")
            if save:
                if not recipient_email.strip():
                    st.error("Recipient email is required.")
                else:
                    item["schedule"] = {
                        "dataset_id": item["id"], "dataset": item["name"], "source": item["source"],
                        "recipient_name": recipient_name.strip(), "recipient_email": recipient_email.strip(),
                        "cadence": cadence, "weekday": weekday, "day_of_month": int(day), "month": int(month),
                        "hour_utc": int(hour), "minute": int(minute), "ai_summary": bool(ai_summary),
                    }
                    save_registry(registry)
                    st.success("Schedule saved.")
                    st.rerun()
            configured = [row["schedule"] for row in registry if row.get("schedule")]
            if configured:
                st.dataframe(pd.DataFrame([{"Dataset": config["dataset"], "Recipient": config["recipient_email"], "Cron (UTC)": cadence_to_cron(config), "Source": config["source"]} for config in configured]), use_container_width=True, hide_index=True)
                a, b = st.columns(2)
                a.download_button("Download schedule_config.csv", configs_to_csv(configured), "schedule_config.csv", "text/csv", use_container_width=True)
                b.download_button("Download GitHub workflow", build_workflow_yaml_for_crons([cadence_to_cron(config) for config in configured]), "scheduled_profiling.yml", "text/yaml", use_container_width=True)
                st.caption("Use a local scheduler for files stored on this computer. The scheduled runner writes importable profiling_history.jsonl snapshots.")

    elif page == "Settings":
        st.header("Settings & backup")
        st.write(f"Dataset records: `{REGISTRY_PATH}`")
        st.write(f"Profiling history: `{HISTORY_PATH}`")
        st.write(f"Reports: `{REPORT_DIR}`")
        st.download_button("Download complete local backup", backup_bytes(), "data_profiling_manager_local_backup.zip", "application/zip", type="primary")
