# Data Profiling Manager — Enterprise Web Rebuild

A professional, local-first React application for data profiling, rule-based data quality evaluation, run comparison, and data observability.

## What this rebuild fixes

- Professional application navigation instead of Streamlit widget styling
- No blank download controls
- Consistent back navigation on asset and run detail pages
- Checkbox-based selection before deleting saved runs
- Visual run comparison with profile and DQ dimension bar charts
- A mandatory schema-change review before saving a mismatched run under an existing asset
- Cross-dataset quality, issue, volume, and trend dashboards
- Asset-level profiling, DQ, observability, and history views
- One issue queue for DQ failures, schema changes, volume shifts, anomalies, and freshness findings

## Product model

- **Asset first:** profiles, runs, rules, issues, and observability stay attached to a named data asset.
- **Rule-based DQ:** quality is based on record-level pass/fail evaluation across contributing dimensions. It is not a simple average of profile statistics.
- **Profiling and DQ are distinct:** profile statistics describe the data; DQ rules evaluate it against expectations.
- **Observability includes change:** schema, volume, freshness, statistical anomalies, and DQ findings are surfaced as issues.
- **Human confirmation:** schema mismatches must be reviewed before a run is assigned to an existing asset.

## Current capabilities

- CSV and `.xlsx` profiling in the browser
- Inferred datatypes and schema fingerprints
- Null-like value recognition
- Distinct, unique, duplicate, top-value, pattern, and numeric statistics
- IQR outlier detection
- Starter DQ evaluation across Completeness, Validity, Uniqueness, Consistency, and Timeliness
- Record-level overall quality calculation
- Dataset registry and asset detail pages
- Historical run retention in IndexedDB
- Run comparison and schema diffs
- Issue generation and status workflow
- Workspace dashboard and DQ dimension trends
- JSON workspace export
- Demo workspace

## Privacy and storage

The current web rebuild is local-first:

- Raw CSV and Excel rows are processed in the browser.
- Raw rows are not sent to an application server.
- Aggregate profiles, runs, rules, and issues are stored in IndexedDB in the current browser profile.
- Clearing browser storage deletes the workspace unless a JSON backup was exported.

This is a strong single-user web foundation, not yet a multi-user enterprise deployment. Team access, authentication, server-side scheduling, durable remote storage, and notifications require the Cloudflare backend described in `ARCHITECTURE.md`.

## Development

```bash
npm install
npm run test
npm run build
npm run dev
```

## Cloudflare deployment

### Cloudflare Pages

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `enterprise-ui`

The included `public/_redirects` file enables SPA routing.

### Cloudflare Workers static assets

```bash
npm run build
npx wrangler deploy
```

The included `wrangler.toml` serves `dist` and falls back to `index.html` for application routes.

## Relationship to the Python edition

The existing Python profiler remains useful as the downloadable/local engine for `.xls`, Parquet, scheduled jobs, email delivery, and environments where files must remain on a local machine. This React application is the new hosted product shell.
