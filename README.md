# Data Profiling Manager

**Profile. Govern. Monitor. Compare.**

Data Profiling Manager is a free, open-source data profiling and governed data-quality workspace. The current web application runs on Cloudflare Workers and performs browser-supported file profiling locally in the visitor's browser.

## Current web application

Open: **https://data-profiling-manager.ann-dahiya.workers.dev**

The React/TypeScript application includes:

- CSV, TXT, and `.xlsx` browser profiling
- reusable linked-file and linked-folder sources in supported Chromium browsers
- named data assets and historical profiling runs
- asset metadata editing, per-asset backups, and controlled cascade deletion
- schema-change warnings
- advanced numerical, text, date, pattern, outlier, cardinality, and correlation profiles
- governed quality dimensions and editable rules
- weighted rule and dimension scoring
- a separate records-passing-all-rules measure
- recurring issue lifecycle with occurrence history and automatic resolution
- comparisons and trends
- formatted Excel DQ reports and technical JSON exports
- monitoring thresholds, daily/weekly/monthly/quarterly/yearly schedules, and steward email settings
- PostgreSQL, Supabase, Snowflake, and DB2 metadata/configuration for local agents
- browser-workspace backup, restore, retention, cleanup, demo data, and deletion
- background Web Worker profiling with progress and cancellation

The older Streamlit edition remains in the repository for local and historical compatibility, but it is not the current Cloudflare interface.

## Governed DQ scoring

Profiling observations and official DQ scoring are deliberately separate.

- Profiling-derived suggestions are recommendations only.
- An official DQ score is calculated only when applicable active governed rules exist for the asset.
- A run without applicable governed rules displays **N/A**, not `0%` or `100%`.
- Overall quality is the weighted average of rule pass rates within weighted contributing dimensions.
- **Records passing all active rules** is a stricter, separate measure.
- Each new browser run retains the exact evaluated rule and dimension configuration, engine version, and configuration fingerprint for historical reporting.

Rule changes apply to future runs. They do not rewrite the evaluation configuration stored with a completed run.

## Browser privacy and persistence

The Cloudflare application is local-first:

- uploaded rows are parsed and profiled in a browser Web Worker
- raw rows are not sent to a Data Profiling Manager application server
- datasets, aggregate profiles, runs, issues, rules, dimensions, monitors, settings, and non-secret connection metadata are stored in browser IndexedDB
- database usernames, passwords, tokens, private keys, SMTP credentials, and Gemini credentials are not stored in browser connection records
- new browser profiles redact raw top-value text before saving the profile
- patterns, ranges, dates, counts, SQL queries, host metadata, steward addresses, and older imported profiles can still be sensitive
- a workspace or asset backup should therefore be treated as potentially sensitive

Browser data does not automatically sync between browsers or devices. Clearing site storage removes the workspace. Use **Settings → Export workspace backup** before clearing data or loading a demo over an existing workspace. Linked local file permissions cannot be transferred in a JSON backup and must be re-established after restore.

Do not use the public instance for confidential, regulated, proprietary, or highly sensitive data unless your organization has reviewed and approved the browser-based workflow. Use the local edition or an approved internal deployment when stricter controls are required.

## Browser limits and supported formats

The hardened browser path supports:

- CSV
- TXT
- `.xlsx`
- up to 50 MB per selected file
- up to 250,000 rows
- up to 250 columns
- correlations across up to the first 40 numerical columns

The profiling pipeline runs outside the main UI thread. The browser displays progress and allows the user to cancel before a run is saved.

Use the local Python edition for:

- legacy `.xls`
- Parquet
- larger files
- broader profiling jobs
- unattended local-folder access
- private database execution

CSV source text is preserved during parsing, so values such as `00123` are not rewritten to `123` before profiling. The browser's conservative default missing markers are blank values, `null`, `n/a`, `nan`, and `(blank)`; business values such as `unknown`, `NA`, and `none` are retained as observed values in the hardened browser profiler.

## Asset administration

Each data asset can be edited, backed up, refreshed, or deleted.

Deleting an asset requires typing its exact name and removes its browser-stored:

- profile runs
- issues
- governed rules
- monitoring policy
- database connection metadata
- linked file or folder handle

Download the asset backup before deletion when its history may be needed later.

## Issues and retention

A recurring finding updates the existing active issue instead of adding a duplicate on every run. The issue stores its first detection, latest detection, occurrence count, current result, and status. Managed findings are resolved automatically when a later run no longer detects them.

Workspace retention is configurable in Settings:

- maximum saved runs per asset
- number of days to retain resolved or closed issues
- automatic cleanup after successful profiles
- manual cleanup at any time

Open and acknowledged issues are not deleted by the retention policy.

## Linked files and folders

In Chrome or Edge, an asset can retain a user-approved file or folder handle in IndexedDB.

- **Linked file** reads the latest saved contents of the same approved file.
- **Linked folder** selects a matching file using either most-recently-modified or highest-filename/version behavior.

A browser may ask the user to renew permission. Linked browser handles cannot run unattended after the browser closes.

## Scheduling and steward alerts

The web application stores monitoring policy and exports runner configuration. It does not silently read a laptop or send email after the browser closes.

Supported cadence options are daily, weekly, monthly, quarterly, and yearly. Quarterly schedules use the selected starting month.

Exports include:

- `schedule_config.csv`
- `quality_config.json`
- a generated GitHub Actions workflow

The generated workflow defaults to a self-hosted Linux runner because local files, network shares, and private databases normally cannot be accessed from a public GitHub-hosted runner. It does not invent a recurring schedule when every monitor is paused.

The Python scheduled agent can:

1. read a durable file, URL, or configured database source
2. profile the source
3. evaluate exported governed rules
4. check monitoring thresholds
5. create an Excel report
6. optionally request a Gemini explanation using aggregate metrics
7. email a steward after every run or only on breach
8. retain logs and importable history

Required SMTP environment variables:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
```

Optional AI variables:

```text
GEMINI_API_KEY
GEMINI_MODEL
```

Local paths require a local scheduler or self-hosted runner with access to that path.

## Database sources

The browser stores non-secret connector metadata and a read-only query. It does not connect directly to company databases.

Supported local-agent providers:

- PostgreSQL
- Supabase
- Snowflake
- DB2

Credentials are read from environment variables derived from each connection's secret prefix:

```text
<PREFIX>_USER
<PREFIX>_PASSWORD
```

Use a genuinely read-only database account restricted to the intended objects. The generated database workflow defaults to a self-hosted Linux runner because private databases should not be exposed to a public GitHub-hosted runner.

Install optional connectors with:

```bash
pip install -r requirements.txt -r requirements-connectors.txt
```

Manual database profile:

```bash
python database_profiling_agent.py <connection-id>
```

Scheduled database profiles:

```bash
python database_scheduled_agent.py --all
python database_scheduled_agent.py --cron "0 7 1 * *"
```

## Local Python edition

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run local_app.py
```

The local edition is appropriate when source files must remain on the machine running the application or recurring jobs require durable filesystem access.

## React development

```bash
cd enterprise-ui
npm ci
npm test
npm run build
npm run dev
```

Production deployment installs the frozen dependency tree, audits high-severity dependencies, tests the web application, compiles the production bundle, deploys static assets through Wrangler, and smoke-tests the public `/overview` route.

## Python tests

```bash
python -m unittest discover -s tests -v
python -m compileall -q .
```

## Important release behavior

- Loading demo data replaces the existing browser workspace and requires confirmation when work already exists.
- Workspace restore replaces the current browser workspace and also requires confirmation.
- Deleting a database connection removes dependent monitor references and returns the linked asset to manual-upload mode.
- Deleting a data asset cascades through its browser-stored runs, issues, rules, monitor, connection metadata, and linked source handle.
- New browser profiles do not retain raw top values, but older runs and imported backups may still contain them.
- The DQ score is not a universal certification that data is accurate or fit for every purpose; it is the result of the active governed rules and weights captured for that run.

## License

MIT License. See [LICENSE](LICENSE).

Created by **Aanchal Dahiya**.
