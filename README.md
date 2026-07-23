# Data Profiling Manager

**Profile. Monitor. Compare.**

Data Profiling Manager is an open-source Streamlit application for profiling CSV, Excel, and Parquet datasets, generating downloadable Excel reports, and optionally explaining aggregate results with Gemini.

The interface and Excel reports use the same deep-indigo and periwinkle visual system. The dashboard cards are real navigation controls, not decorative links.

The repository includes two entry points so the hosted version stays safe for multiple visitors without stripping out the full local workflow.

## 1. Public hosted app — `app.py`

Use this entry point on Streamlit Community Cloud.

- branded dashboard and profiling interface
- CSV, Excel, and Parquet upload
- basic and advanced profiling
- correlation analysis
- downloadable Excel report
- optional Gemini explanation using the visitor's own API key
- scheduling and email configuration generator
- no shared Gemini key
- no intentional cross-user dataset history

The hosted site cannot retain a temporary browser upload and profile it again after the visitor leaves. Its Scheduling & email page generates the configuration and workflow needed by a durable runner.

## 2. Full local manager — `local_app.py`

Use this edition for private data and recurring work.

- register datasets once using local paths or accessible URLs
- edit and delete saved datasets
- run profiles without selecting the file again
- keep local run history and generated reports
- configure cadence and report recipients per dataset
- generate `schedule_config.csv` and GitHub Actions YAML
- back up the local registry, history, and reports

All local state is stored under `.profiling_manager/` on the machine running the app.

## Run the hosted-style app locally

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

## Run the full local manager

```bash
streamlit run local_app.py
```

## Deploy on Streamlit Community Cloud

- Repository: `https://github.com/anndahiya/Data-Profiling-Manager`
- Branch: `main`
- Main file path: `app.py`

## Gemini behavior

Gemini is optional. The user enters their Gemini API key in a masked field. It is their Gemini credential, not a password for Data Profiling Manager. The application sends aggregate profiling metrics only—not raw rows or sample values.

## Scheduled email reports

The app generates `schedule_config.csv`. The runner in `monthly_profiling_agent.py`:

1. reads the matching schedule rows
2. profiles the configured dataset source
3. creates the Excel report
4. optionally generates a Gemini explanation
5. emails the workbook through the user's SMTP account
6. records the result in `run_log.jsonl`

Examples:

```bash
python monthly_profiling_agent.py --all
python monthly_profiling_agent.py --cron "15 7 1 * *"
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

For private files stored on a personal computer, use cron or Windows Task Scheduler on that computer. A GitHub-hosted runner cannot read a laptop's local file path.

## Main files

- `app.py` — public hosted interface
- `local_app.py` — full local manager
- `data_profiler.py` — deterministic profiling and Excel report generation
- `ai_helper.py` — aggregate-only Gemini integration
- `schedule_helper.py` — schedule configuration and workflow generation
- `monthly_profiling_agent.py` — scheduled profiling and email runner
- `schedule_config.example.csv` — configuration example

## License

MIT License.
