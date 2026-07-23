# Data Profiling Manager

**Profile. Monitor. Compare.**

Data Profiling Manager is a free, open-source application for profiling CSV, Excel, and Parquet files without writing code. It keeps the product focused on factual profiling: schema, completeness, uniqueness, duplicates, distributions, outliers, patterns, history, comparisons, and trends. It does **not** calculate a data quality score.

## Use the hosted app

Open **https://data-profiling-manager.streamlit.app**.

The hosted app supports:

- multiple named datasets
- saved profiling runs that survive browser refreshes
- dashboard cards and charts for each saved run
- historical run selection and snapshot report downloads
- side-by-side run comparison
- row, column, missing-value, duplicate, and memory trends
- optional Gemini explanations using the visitor's own API key
- recurring schedule and email configuration
- browser-data backup and restore
- import of snapshots created by the scheduled runner

### How hosted persistence works

The hosted app stores the dataset registry and **aggregate profiling snapshots in the visitor's browser local storage**. This keeps one visitor's history separate from other visitors and allows saved results to survive a page refresh.

The app does not put raw uploaded rows into browser history. Raw files are processed in the active Streamlit session. Saved snapshots exclude sample values, top values, and min/max values. The browser edition retains up to 30 runs per dataset and 150 runs total, trimming older runs if the saved data approaches 4 MB.

Browser history does not automatically sync to another browser, device, private browsing session, or cleared browser profile. Use **Settings & backup** to download a JSON backup.

> Do not upload confidential, regulated, or highly sensitive data to a public hosted instance. Use the local edition when files must remain on the computer running the app.

## Dashboard, History, Compare, and Trends

Every saved profile is a separate run. Uploading another source does not replace earlier datasets or runs.

- **Dashboard** shows the selected dataset/run, row and column counts, missingness, duplicates, missing-by-column chart, IQR outliers, saved Gemini explanation, factual observations, and changes from the prior run.
- **History** lists all saved runs and recreates a downloadable Excel snapshot from stored metrics.
- **Compare** detects added and removed columns, datatype changes, row and duplicate changes, missing-value changes, and unique-count changes.
- **Trends** charts factual profiling metrics over time.

## Gemini

Gemini is optional. The user enters a Gemini API key in a masked field. It is their Gemini credential, not a password for Data Profiling Manager.

Only aggregate profiling metrics are sent to Gemini. The underlying uploaded rows and sample values are not included. Saved AI explanations are attached to the selected profiling run in browser history.

## Run locally

The local edition stores dataset paths, reports, history, comparisons, trends, AI explanations, and schedule settings under `.profiling_manager/` on the computer running the app.

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

## Scheduled profiling and email reports

The Scheduling screen saves settings per dataset and generates:

- `schedule_config.csv`
- a GitHub Actions workflow with all configured cron schedules

The runner in `monthly_profiling_agent.py`:

1. reads the matching schedule rows
2. profiles CSV, Excel, or Parquet sources
3. creates the Excel report
4. optionally generates a Gemini explanation
5. emails the report through the user's SMTP account
6. writes `run_log.jsonl`
7. writes `profiling_history.jsonl` snapshots for History, Compare, and Trends

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

A public Streamlit upload is temporary and cannot be reused by a future scheduled job. The scheduled runner needs a durable downloadable URL or a file path it can access. For files stored on a personal computer, run the local edition and use cron or Windows Task Scheduler. A GitHub-hosted runner cannot read a laptop's local file path.

GitHub Actions uploads generated reports, logs, and `profiling_history.jsonl` as a workflow artifact. Import that JSONL file from **Settings & backup** in the hosted app to add scheduled runs to browser History, Compare, and Trends.

## Deploy on Streamlit Community Cloud

- Repository: `https://github.com/anndahiya/Data-Profiling-Manager`
- Branch: `main`
- Main file path: `app.py`

## Main files

- `app.py` — hosted app with browser-persistent datasets and profiling history
- `browser_storage.py` — browser local-storage bridge
- `snapshot_manager.py` — saved run, comparison, trend, retention, and snapshot-report logic
- `local_app.py` — full local manager
- `data_profiler.py` — deterministic profiling and full Excel report generation
- `ai_helper.py` — aggregate-only Gemini integration
- `schedule_helper.py` — schedule configuration and workflow generation
- `monthly_profiling_agent.py` — scheduled profiling, email, logging, and history snapshots
- `schedule_config.example.csv` — scheduling example
- `tests/` — regression tests for saved runs, comparison, privacy fields, and report export

## Tests

```bash
python -m unittest discover -s tests -v
```

## License

MIT License. See [LICENSE](LICENSE).
