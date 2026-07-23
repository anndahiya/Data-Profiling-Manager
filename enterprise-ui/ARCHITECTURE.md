# Architecture and Enterprise Roadmap

## Phase 1: local-first web application — implemented in this branch

- React + TypeScript + Vite
- IndexedDB persistence through Dexie
- Browser-side CSV and `.xlsx` profiling
- Rule-based DQ evaluation
- Schema, volume, anomaly, and DQ issues
- Cloudflare Pages or Workers static-assets deployment

This phase provides a professional single-user application without transmitting raw files to a hosted backend.

## Phase 2: shared Cloudflare workspace

A genuinely multi-user or enterprise-usable hosted edition should add:

- **Cloudflare Workers API:** authenticated CRUD, profiling job orchestration, issue workflows, and audit events
- **Cloudflare D1:** organizations, users, assets, runs, rules, monitor policies, issues, schedules, and permissions
- **Cloudflare R2:** encrypted source files, generated reports, and optional invalid-record samples with retention controls
- **Cloudflare Queues:** asynchronous profiling and DQ evaluation jobs
- **Cron Triggers:** scheduled monitoring runs
- **Cloudflare Access or an identity provider:** SSO and role-based access
- **Email/Slack/Teams adapters:** issue and run notifications
- **Audit logging:** who changed rules, acknowledged issues, deleted runs, or changed monitor settings

## Security decisions required before Phase 2

- Whether raw datasets may be uploaded at all
- Encryption and retention requirements
- Tenant isolation model
- Maximum file size and execution limits
- PII handling and invalid-record sample policy
- Regional data residency
- Authentication and authorization model

## Profiling versus data quality

Profiling describes observed characteristics. Data quality evaluates records against explicit expectations. The application keeps the two concepts separate:

- Profile outputs: null rate, distinct count, patterns, distributions, outliers, schema
- DQ outputs: rule pass/fail, dimension pass rates, overall record pass rate
- Observability outputs: change and anomaly issues over time

## Overall quality calculation

A record contributes to Overall Quality only when it passes every active rule in every contributing dimension. Overall Quality is therefore:

```text
records passing all contributing rules / evaluated records
```

It is not the average of the dimension percentages.
