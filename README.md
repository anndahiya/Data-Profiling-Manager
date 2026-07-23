# Data Profiling Manager

**Profile. Monitor. Compare.**

Data Profiling Manager is a free, open-source application for profiling CSV, Excel, and Parquet files without writing code. It focuses on factual profiling—schema, completeness, uniqueness, duplicates, distributions, outliers, patterns, history, comparisons, and trends. It does **not** calculate a data quality score or certify whether data is fit for purpose.

## Hosted app

Open **https://data-profiling-manager.streamlit.app**.

The hosted edition includes:

- CSV, Excel, and Parquet profiling
- optional ad hoc profiling without saving a dataset
- multiple named datasets with descriptions, tags, and owners
- saved profiling runs that survive refreshes in the same browser profile
- dashboard metrics and missing/outlier charts
- an in-app Report Viewer
- successful and failed run history
- side-by-side comparisons between runs of the same dataset
- row, column, duplicate, missing-value, and memory trends
- factual Monitor prompts for missingness, duplicates, schema changes, and row-count changes
- optional Gemini explanations using the visitor's own API key
- recurring schedule and email configuration generation
- browser-data backup and restore
- import of snapshots created by scheduled profiling jobs

## Browser persistence and privacy

The hosted app saves the dataset registry and **aggregate profiling snapshots in the visitor's browser local storage**. Other visitors are not given a way to browse that history through the app.

Raw uploaded rows are processed in the active Streamlit session and are not written to browser history. Saved snapshots exclude sample rows, top values, and min/max values. The browser edition retains up to 30 successful runs per dataset and 150 total, trimming older runs as saved data approaches 4 MB.

Browser history does not automatically sync to another browser, device, private-browsing session, or cleared browser profile. Use **Settings** to download a JSON backup.

> Do not upload confidential, regulated, proprietary, or highly sensitive datasets to a public hosted instance. Use the local edition when files must remain on the computer running the application.

## Core screens

- **Dashboard** — selected dataset/run, row and column counts, missingness, duplicates, charts, saved Gemini explanation, Monitor prompts, and changes from the preceding run.
- **Datasets** — saved dataset records, metadata, run counts, and schedule status.
- **Profile** — saved or ad hoc profiling for CSV, Excel, and Parquet files.
- **Report Viewer** — overview, basic profile, advanced profile, profiling summary, correlations, AI explanation, and Excel downloads.
- **History** — successful and failed profiling attempts, prior reports, and run deletion.
- **Compare** — added/removed columns, datatype changes, row and duplicate changes, missing-value changes, and uniqueness changes.
- **Trends** — factual profiling metrics over time.
- **Monitor** — factual prompts derived from saved profiles; no quality scoring or automated source-data changes.
- **AI explanation** — optional Gemini explanation based only on aggregate profiling metrics.
- **Scheduling** — per-dataset cadence and email-delivery configuration exports.
- **Plugins** — truthful status of built-in and planned connectors.
- **Settings** — backup, restore, scheduled-history import, usage information, and browser-data deletion.

## Gemini

Gemini is optional. The user enters a Gemini API key in a masked field. It is their Gemini credential, not a password for Data Profiling Manager.

Only aggregate profiling metrics are sent to Gemini. Raw uploaded rows and sample values are not included. A generated explanation can be saved with the applicable profiling run.

The deterministic profile and Excel reports work without Gemini.

## Local edition

The local edition stores dataset paths, reports, profiling snapshots, failure history, comparisons, trends, AI explanations, and schedules under `.profiling_manager/` on the computer running the app.

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run local_app.py
```

Use the hosted-style entry point locally with:

```bash
streamlit run app.py
```

The local edition is the appropriate choice for private files and recurring jobs that need access to paths on the user's computer.

## Scheduled profiling and email reports

The Scheduling screen exports:

- `schedule_config.csv`
- a GitHub Actions workflow containing the configured cron schedules

The runner in `monthly_profiling_agent.py`:

1. reads the matching schedule rows
2. profiles a CSV, Excel, or Parquet source
3. creates the Excel report
4. optionally requests a Gemini explanation
5. emails the workbook through the user's SMTP account
6. records operational results in `run_log.jsonl`
7. writes importable snapshots to `profiling_history.jsonl`
8. keeps the deterministic report and snapshot even when optional AI or email delivery fails

Commands:

```bash
python monthly_profiling_agent.py --all
python monthly_profiling_agent.py --cron "0 7 1 * *"
python monthly_profiling_agent.py --dataset customer-master
```

Required email environment variables:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
```

Optional:

```text
GEMINI_API_KEY
GEMINI_MODEL
```

A future scheduled job cannot reuse a temporary browser upload. The runner needs a durable downloadable URL or a file path available on the machine executing the job. A GitHub-hosted runner cannot read a file stored only on a personal laptop; use the local edition with cron or Windows Task Scheduler for that case.

Generated reports, logs, and `profiling_history.jsonl` can be retained as GitHub Actions artifacts. Import `profiling_history.jsonl` from **Settings** to add scheduled runs to the hosted browser's Datasets, Report Viewer, History, Compare, Trends, and Monitor screens.

## Built-in and planned connectors

Available now:

- CSV
- Excel (`.xlsx` and `.xls`)
- Parquet

Planned for a future plugin SDK—but **not claimed as installed today**:

- PostgreSQL, SQL Server, MySQL
- Snowflake, BigQuery, Databricks, Fabric
- S3, Azure Blob, Google Cloud Storage
- REST API and ODBC

## Excel report safety

The application normalizes blank and duplicate column names, handles complex/unhashable values, treats infinities safely during numeric analysis, and neutralizes formula-like source text before writing generated Excel workbooks.

## Deploy on Streamlit Community Cloud

- Repository: `https://github.com/anndahiya/Data-Profiling-Manager`
- Branch: `main`
- Main file path: `app.py`

Dependencies are pinned and tested on Python 3.11 and Python 3.14.

## Main files

- `app.py` — hosted application entry point
- `hosted_common.py` — hosted persistence, navigation, branding, and shared helpers
- `hosted_dashboard.py` — dashboard
- `hosted_profile_pages.py` — datasets, profile, and Report Viewer
- `hosted_analysis_pages.py` — history, compare, trends, Monitor, and AI
- `hosted_settings_pages.py` — scheduling, plugins, backup, and restore
- `browser_storage.py` — browser-local persistence bridge
- `snapshot_manager.py` — saved runs, comparisons, trends, retention, monitoring, and snapshot reports
- `local_app.py`, `local_common.py`, `local_pages.py` — full local edition
- `data_profiler.py` — deterministic profiling and full Excel report generation
- `ai_helper.py` — aggregate-only Gemini integration
- `schedule_helper.py` — scheduling configuration and workflow generation
- `monthly_profiling_agent.py` — scheduled profiling, email delivery, logs, and snapshots
- `tests/` — unit, edge-case, security, and Streamlit page-rendering tests

## Tests

```bash
python -m unittest discover -s tests -v
python -m compileall -q .
```

GitHub Actions runs the full suite on Python 3.11 and Python 3.14, including simulated rendering of every hosted page and the local application.

## License

MIT License. See [LICENSE](LICENSE).

Created by **Aanchal Dahiya**.
