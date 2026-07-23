"""Scheduled profiling, threshold evaluation, and steward email delivery.

Reads ``schedule_config.csv`` and optional ``quality_config.json``, profiles matching
sources, evaluates governed quality rules and monitoring thresholds, creates an
Excel report, optionally adds a Gemini explanation, and records an importable
snapshot for every attempted successful profile.

Examples:
    python monthly_profiling_agent.py --all
    python monthly_profiling_agent.py --cron "0 7 1 * *"
    python monthly_profiling_agent.py --dataset customer-master
"""
from __future__ import annotations

import argparse
import json
import math
import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import pandas as pd

from ai_helper import build_ai_payload, generate_gemini_summary
from data_profiler import build_report, read_table
from quality_engine import evaluate_quality, load_quality_config
from schedule_helper import cadence_to_cron
from snapshot_manager import create_snapshot

CONFIG_FILE = Path(os.environ.get("DPM_SCHEDULE_CONFIG", "schedule_config.csv"))
QUALITY_CONFIG_FILE = Path(os.environ.get("DPM_QUALITY_CONFIG", "quality_config.json"))
LOG_FILE = Path(os.environ.get("DPM_RUN_LOG", "run_log.jsonl"))
HISTORY_FILE = Path(os.environ.get("DPM_HISTORY_FILE", "profiling_history.jsonl"))
REPORT_DIR = Path(os.environ.get("DPM_REPORT_DIR", "scheduled_reports"))
SUCCESS_STATUSES = {"sent_alert", "sent_report", "healthy_no_email"}


def parse_bool(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def safe_int(value: Any, default: int) -> int:
    try:
        text = str(value).strip()
        return int(float(text)) if text else default
    except (TypeError, ValueError):
        return default


def optional_float(value: Any) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def optional_int(value: Any) -> int | None:
    parsed = optional_float(value)
    return int(parsed) if parsed is not None else None


def parse_email_list(value: Any) -> list[str]:
    text = str(value or "").replace(";", ",")
    return [item.strip() for item in text.split(",") if item.strip()]


def normalize_row(row: pd.Series) -> dict[str, Any]:
    dataset = str(row.get("dataset") or "dataset").strip()
    dataset_id = str(row.get("dataset_id") or dataset).strip().lower().replace(" ", "-")
    delivery_mode = str(row.get("delivery_mode") or "every-run").strip().lower()
    if delivery_mode not in {"every-run", "breach-only"}:
        delivery_mode = "every-run"
    return {
        "dataset_id": dataset_id,
        "dataset": dataset,
        "source": str(row.get("source") or "").strip(),
        "recipient_name": str(row.get("recipient_name") or "there").strip(),
        "recipient_email": str(row.get("recipient_email") or "").strip(),
        "cc_emails": parse_email_list(row.get("cc_emails", "")),
        "cadence": str(row.get("cadence") or "Monthly").strip(),
        "weekday": str(row.get("weekday") or "Monday").strip(),
        "day_of_month": safe_int(row.get("day_of_month"), 1),
        "month": safe_int(row.get("month"), 1),
        "hour_utc": safe_int(row.get("hour_utc"), 7),
        "minute": safe_int(row.get("minute"), 0),
        "delivery_mode": delivery_mode,
        "attach_report": parse_bool(row.get("attach_report", True)),
        "ai_summary": parse_bool(row.get("ai_summary", False)),
        "minimum_overall_quality": optional_float(row.get("minimum_overall_quality")),
        "minimum_record_compliance": optional_float(row.get("minimum_record_compliance")),
        "maximum_missing_percent": optional_float(row.get("maximum_missing_percent")),
        "maximum_duplicate_rows": optional_int(row.get("maximum_duplicate_rows")),
        "maximum_row_change_percent": optional_float(row.get("maximum_row_change_percent")),
        "maximum_freshness_hours": optional_float(row.get("maximum_freshness_hours")),
        "cron": str(row.get("cron") or "").strip(),
    }


def load_config() -> list[dict[str, Any]]:
    if not CONFIG_FILE.exists():
        raise FileNotFoundError(f"No schedule configuration found at {CONFIG_FILE}.")
    frame = pd.read_csv(CONFIG_FILE, encoding="utf-8-sig").fillna("")
    rows = [normalize_row(row) for _, row in frame.iterrows()]
    if not rows:
        raise ValueError("The schedule configuration does not contain any dataset rows.")
    return rows


def send_email(
    to_email: str,
    subject: str,
    body: str,
    attachment_path: Path | None = None,
    cc_emails: list[str] | None = None,
) -> None:
    host = (os.environ.get("SMTP_HOST") or "").strip()
    user = (os.environ.get("SMTP_USER") or "").strip()
    password = os.environ.get("SMTP_PASS") or ""
    port = safe_int(os.environ.get("SMTP_PORT"), 587)
    if not host or not user or not password:
        raise RuntimeError("SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured.")
    if "@" not in to_email:
        raise ValueError("The primary recipient email address is invalid.")
    invalid_cc = [email for email in (cc_emails or []) if "@" not in email]
    if invalid_cc:
        raise ValueError(f"Invalid CC email address: {invalid_cc[0]}")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = user
    message["To"] = to_email
    if cc_emails:
        message["Cc"] = ", ".join(cc_emails)
    message.set_content(body)
    if attachment_path is not None:
        message.add_attachment(
            attachment_path.read_bytes(),
            maintype="application",
            subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=attachment_path.name,
        )

    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=60) as smtp:
            smtp.login(user, password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=60) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            smtp.login(user, password)
            smtp.send_message(message)


def generate_ai_text(df: pd.DataFrame, dataset: str, enabled: bool) -> tuple[str | None, str | None]:
    api_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not enabled or not api_key:
        return None, None
    model = (os.environ.get("GEMINI_MODEL") or "gemini-2.5-flash").strip()
    try:
        return generate_gemini_summary(api_key, build_ai_payload(df, dataset), model), None
    except Exception as exc:
        return None, str(exc)[:500]


def select_rows(rows: list[dict[str, Any]], args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.dataset:
        return [row for row in rows if row["dataset_id"] == args.dataset or row["dataset"] == args.dataset]
    if args.cron:
        return [row for row in rows if (row.get("cron") or cadence_to_cron(row)) == args.cron]
    if args.all:
        return rows
    raise ValueError("Choose --all, --cron, or --dataset.")


def append_jsonl(path: Path, entry: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(entry, ensure_ascii=False, default=str) + "\n")


def load_previous_snapshot(dataset_id: str) -> dict[str, Any] | None:
    if not HISTORY_FILE.exists():
        return None
    latest: dict[str, Any] | None = None
    for line in HISTORY_FILE.read_text(encoding="utf-8").splitlines():
        try:
            item = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(item, dict) and str(item.get("dataset_id")) == dataset_id:
            if latest is None or str(item.get("profiled_at", "")) > str(latest.get("profiled_at", "")):
                latest = item
    return latest


def source_age_hours(source: str) -> float | None:
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        try:
            request = Request(source, method="HEAD", headers={"User-Agent": "Data-Profiling-Manager/1.0"})
            with urlopen(request, timeout=20) as response:
                modified = response.headers.get("Last-Modified")
            if not modified:
                return None
            timestamp = parsedate_to_datetime(modified)
            if timestamp.tzinfo is None:
                timestamp = timestamp.replace(tzinfo=timezone.utc)
            return max(0.0, (datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)).total_seconds() / 3600)
        except Exception:
            return None
    path = Path(source).expanduser()
    if not path.is_file():
        return None
    modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return max(0.0, (datetime.now(timezone.utc) - modified).total_seconds() / 3600)


def evaluate_thresholds(
    row: dict[str, Any],
    snapshot: dict[str, Any],
    previous: dict[str, Any] | None,
    quality: dict[str, Any] | None,
) -> tuple[list[str], list[str]]:
    breaches: list[str] = []
    notes: list[str] = []
    minimum_quality = row.get("minimum_overall_quality")
    minimum_compliance = row.get("minimum_record_compliance")
    if (minimum_quality is not None or minimum_compliance is not None) and quality is None:
        raise RuntimeError(
            "A quality threshold is configured, but no governed rules were found for this dataset in quality_config.json. "
            "Export quality_config.json from Rules & dimensions and place it beside the runner."
        )
    if minimum_quality is not None and quality and float(quality["overall_score"]) < float(minimum_quality):
        breaches.append(f"Overall quality {float(quality['overall_score']):.1f}% is below {float(minimum_quality):.1f}%.")
    if minimum_compliance is not None and quality and float(quality["record_compliance_score"]) < float(minimum_compliance):
        breaches.append(f"Strict record compliance {float(quality['record_compliance_score']):.1f}% is below {float(minimum_compliance):.1f}%.")
    if quality:
        for result in quality.get("rule_results", []):
            if float(result.get("score", 100)) < float(result.get("threshold", 0)):
                breaches.append(
                    f"Rule {result.get('rule_name', 'Rule')} scored {float(result.get('score', 0)):.1f}% "
                    f"against its {float(result.get('threshold', 0)):.1f}% threshold."
                )

    maximum_missing = row.get("maximum_missing_percent")
    if maximum_missing is not None and float(snapshot.get("overall_missing_percent", 0)) > float(maximum_missing):
        breaches.append(f"Missing cells {float(snapshot.get('overall_missing_percent', 0)):.1f}% exceed {float(maximum_missing):.1f}%.")
    maximum_duplicates = row.get("maximum_duplicate_rows")
    if maximum_duplicates is not None and int(snapshot.get("duplicate_rows", 0)) > int(maximum_duplicates):
        breaches.append(f"{int(snapshot.get('duplicate_rows', 0)):,} duplicate rows exceed {int(maximum_duplicates):,}.")
    maximum_row_change = row.get("maximum_row_change_percent")
    if maximum_row_change is not None:
        previous_rows = int(previous.get("rows", 0)) if previous else 0
        if previous_rows:
            change = abs((int(snapshot.get("rows", 0)) - previous_rows) / previous_rows * 100.0)
            if change > float(maximum_row_change):
                breaches.append(f"Row count changed {change:.1f}%, above {float(maximum_row_change):.1f}%.")
        else:
            notes.append("Row-count change was not evaluated because no prior successful snapshot exists.")
    maximum_freshness = row.get("maximum_freshness_hours")
    if maximum_freshness is not None:
        age = source_age_hours(str(row.get("source") or ""))
        if age is None:
            breaches.append("Source freshness could not be evaluated because the source does not expose a readable modified timestamp.")
        elif age > float(maximum_freshness):
            breaches.append(f"Source data is {age:.1f} hours old, above {float(maximum_freshness):.1f} hours.")
    return breaches, notes


def should_send_email(delivery_mode: str, breaches: list[str]) -> bool:
    return delivery_mode == "every-run" or bool(breaches)


def build_email_body(
    row: dict[str, Any],
    snapshot: dict[str, Any],
    quality: dict[str, Any] | None,
    breaches: list[str],
    notes: list[str],
    ai_summary: str | None,
    ai_error: str | None,
) -> str:
    lines = [f"Hi {row['recipient_name']},", ""]
    if breaches:
        lines.extend([f"The scheduled profile for {row['dataset']} completed with {len(breaches)} threshold breach{'es' if len(breaches) != 1 else ''}:", ""])
        lines.extend(f"- {item}" for item in breaches)
    else:
        lines.append(f"The scheduled profile for {row['dataset']} completed within the configured thresholds.")
    lines.extend([
        "",
        f"Rows: {int(snapshot.get('rows', 0)):,}",
        f"Columns: {int(snapshot.get('columns', 0)):,}",
        f"Missing cells: {int(snapshot.get('missing_cells', 0)):,} ({float(snapshot.get('overall_missing_percent', 0)):.2f}%)",
        f"Duplicate rows: {int(snapshot.get('duplicate_rows', 0)):,}",
    ])
    if quality:
        lines.extend([
            f"Overall quality: {float(quality['overall_score']):.1f}%",
            f"Strict record compliance: {float(quality['record_compliance_score']):.1f}%",
            f"Governed rules evaluated: {int(quality['rules_evaluated'])}",
        ])
    if notes:
        lines.extend(["", "Evaluation notes:", *[f"- {item}" for item in notes]])
    if ai_summary:
        lines.extend(["", "Optional Gemini explanation based only on aggregate profiling metrics:", "", ai_summary])
    elif ai_error:
        lines.extend(["", "The deterministic profile completed, but the optional Gemini explanation could not be generated."])
    lines.extend(["", "Review the business context before drawing conclusions.", "", "— Data Profiling Manager by Aanchal Dahiya"])
    return "\n".join(lines)


def process(row: dict[str, Any], quality_config: dict[str, Any] | None = None) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    dataset = row["dataset"]
    source = row["source"]
    recipient = row["recipient_email"]
    if not source or not recipient:
        raise ValueError("The source and primary recipient email are required.")

    previous = load_previous_snapshot(row["dataset_id"])
    frame = read_table(source)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(character if character.isalnum() or character in "-_" else "_" for character in dataset) or "dataset"
    report_path = REPORT_DIR / f"{safe_name}_profiling_{started:%Y-%m-%d_%H%M%S}.xlsx"
    build_report(frame, source, str(report_path))

    summary, ai_error = generate_ai_text(frame, dataset, row["ai_summary"])
    snapshot = create_snapshot(
        frame,
        dataset_id=row["dataset_id"],
        dataset_name=dataset,
        source_name=source,
        owner=row.get("recipient_name", ""),
    )
    quality = evaluate_quality(frame, row["dataset_id"], quality_config)
    snapshot["quality_summary"] = quality
    snapshot["ai_summary"] = summary
    snapshot["ai_error"] = ai_error
    snapshot["report_path"] = str(report_path)
    snapshot["run_source"] = "scheduled"

    try:
        breaches, notes = evaluate_thresholds(row, snapshot, previous, quality)
    except Exception as exc:
        snapshot["delivery_status"] = "configuration_failed"
        snapshot["delivery_error"] = str(exc)[:500]
        append_jsonl(HISTORY_FILE, snapshot)
        raise
    snapshot["monitor_breaches"] = breaches
    snapshot["monitor_notes"] = notes

    if not should_send_email(row["delivery_mode"], breaches):
        snapshot["delivery_status"] = "healthy_no_email"
        append_jsonl(HISTORY_FILE, snapshot)
        return {
            "timestamp_utc": started.isoformat(timespec="seconds"),
            "run_id": snapshot["run_id"],
            "dataset": dataset,
            "recipient": recipient,
            "rows": int(len(frame)),
            "columns": int(frame.shape[1]),
            "report_path": str(report_path),
            "breach_count": 0,
            "ai_status": "generated" if summary else ("failed" if ai_error else "not_requested"),
            "status": "healthy_no_email",
        }

    alert = bool(breaches)
    subject_prefix = "[ALERT]" if alert else "[REPORT]"
    body = build_email_body(row, snapshot, quality, breaches, notes, summary, ai_error)
    try:
        send_email(
            recipient,
            f"{subject_prefix} [{dataset}] Data Profiling — {started:%Y-%m-%d}",
            body,
            report_path if row["attach_report"] else None,
            row["cc_emails"],
        )
    except Exception as exc:
        snapshot["delivery_status"] = "email_failed"
        snapshot["delivery_error"] = str(exc)[:500]
        append_jsonl(HISTORY_FILE, snapshot)
        raise RuntimeError(f"The profile and report were created, but email delivery failed: {exc}") from exc

    status = "sent_alert" if alert else "sent_report"
    snapshot["delivery_status"] = status
    append_jsonl(HISTORY_FILE, snapshot)
    return {
        "timestamp_utc": started.isoformat(timespec="seconds"),
        "run_id": snapshot["run_id"],
        "dataset": dataset,
        "recipient": recipient,
        "cc_recipients": row["cc_emails"],
        "rows": int(len(frame)),
        "columns": int(frame.shape[1]),
        "report_path": str(report_path),
        "breach_count": len(breaches),
        "ai_status": "generated" if summary else ("failed" if ai_error else "not_requested"),
        "status": status,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Process every configured dataset.")
    parser.add_argument("--cron", help="Process rows whose configured cron matches this value.")
    parser.add_argument("--dataset", help="Process one dataset ID or exact dataset name.")
    args = parser.parse_args()

    try:
        selected = select_rows(load_config(), args)
        quality_config = load_quality_config(QUALITY_CONFIG_FILE)
    except Exception as exc:
        print(f"Configuration error: {exc}")
        return 2
    if not selected:
        print("No datasets matched this run.")
        return 0

    entries: list[dict[str, Any]] = []
    for row in selected:
        try:
            entry = process(row, quality_config)
            if entry["status"] == "healthy_no_email":
                print(f"{row['dataset']}: healthy; email suppressed by breach-only delivery")
            else:
                print(f"{row['dataset']}: {entry['status']} to {row['recipient_email']}")
        except Exception as exc:
            entry = {
                "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "dataset": row.get("dataset"),
                "recipient": row.get("recipient_email"),
                "status": f"failed: {exc}",
            }
            print(f"{row.get('dataset')}: FAILED — {exc}")
        entries.append(entry)
        append_jsonl(LOG_FILE, entry)
    return 1 if any(entry["status"] not in SUCCESS_STATUSES for entry in entries) else 0


if __name__ == "__main__":
    raise SystemExit(main())
