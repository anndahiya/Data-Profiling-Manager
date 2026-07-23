"""Scheduled profiling and email runner for Data Profiling Manager.

Reads ``schedule_config.csv``, profiles matching datasets, optionally creates a
Gemini explanation from aggregate metrics, emails the Excel report, and writes
both an operational log and importable profiling snapshots.

Examples:
    python monthly_profiling_agent.py --all
    python monthly_profiling_agent.py --cron "0 7 1 * *"
    python monthly_profiling_agent.py --dataset customer-master
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import pandas as pd

from ai_helper import build_ai_payload, generate_gemini_summary
from data_profiler import build_report
from schedule_helper import cadence_to_cron
from snapshot_manager import create_snapshot

CONFIG_FILE = Path(os.environ.get("DPM_SCHEDULE_CONFIG", "schedule_config.csv"))
LOG_FILE = Path(os.environ.get("DPM_RUN_LOG", "run_log.jsonl"))
HISTORY_FILE = Path(os.environ.get("DPM_HISTORY_FILE", "profiling_history.jsonl"))
REPORT_DIR = Path(os.environ.get("DPM_REPORT_DIR", "scheduled_reports"))


def parse_bool(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def normalize_row(row: pd.Series) -> dict[str, Any]:
    dataset = str(row.get("dataset") or "dataset")
    return {
        "dataset_id": str(row.get("dataset_id") or dataset).strip().lower().replace(" ", "-"),
        "dataset": dataset,
        "source": str(row.get("source") or ""),
        "recipient_name": str(row.get("recipient_name") or "there"),
        "recipient_email": str(row.get("recipient_email") or ""),
        "cadence": str(row.get("cadence") or "Monthly"),
        "weekday": str(row.get("weekday") or "Monday"),
        "day_of_month": int(row.get("day_of_month") or 1),
        "month": int(row.get("month") or 1),
        "hour_utc": int(row.get("hour_utc") or 7),
        "minute": int(row.get("minute") or 0),
        "ai_summary": parse_bool(row.get("ai_summary", False)),
        "cron": str(row.get("cron") or "").strip(),
    }


def load_config() -> list[dict[str, Any]]:
    if not CONFIG_FILE.exists():
        raise FileNotFoundError(f"No schedule configuration found at {CONFIG_FILE}.")
    frame = pd.read_csv(CONFIG_FILE).fillna("")
    return [normalize_row(row) for _, row in frame.iterrows()]


def read_source(source: str) -> pd.DataFrame:
    suffix = Path(source.split("?", 1)[0]).suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(source)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(source)
    if suffix == ".parquet":
        return pd.read_parquet(source)
    raise ValueError("Only CSV, Excel, and Parquet sources are supported.")


def send_email(to_email: str, subject: str, body: str, attachment_path: Path) -> None:
    host = os.environ.get("SMTP_HOST")
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_PASS")
    port = int(os.environ.get("SMTP_PORT", "587"))
    if not host or not user or not password:
        raise RuntimeError("SMTP_HOST, SMTP_USER, and SMTP_PASS must be configured.")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = user
    message["To"] = to_email
    message.set_content(body)
    message.add_attachment(
        attachment_path.read_bytes(),
        maintype="application",
        subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=attachment_path.name,
    )
    with smtplib.SMTP(host, port, timeout=60) as smtp:
        smtp.starttls()
        smtp.login(user, password)
        smtp.send_message(message)


def generate_ai_text(df: pd.DataFrame, dataset: str, enabled: bool) -> str | None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not enabled or not api_key:
        return None
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    return generate_gemini_summary(api_key, build_ai_payload(df, dataset), model)


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


def process(row: dict[str, Any]) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    dataset = row["dataset"]
    source = row["source"]
    recipient = row["recipient_email"]
    if not source or not recipient:
        raise ValueError("The source and recipient email are required.")

    df = read_source(source)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(character if character.isalnum() or character in "-_" else "_" for character in dataset)
    report_path = REPORT_DIR / f"{safe_name}_profiling_{started:%Y-%m-%d_%H%M%S}.xlsx"
    build_report(df, source, str(report_path))
    summary = generate_ai_text(df, dataset, row["ai_summary"])

    body = (
        f"Hi {row['recipient_name']},\n\n"
        f"Attached is the {started:%Y-%m-%d} profiling report for {dataset}.\n\n"
        + (f"Gemini explanation based only on aggregate profiling metrics:\n\n{summary}\n\n" if summary else "")
        + "The workbook contains factual profiling results. Review the business context before drawing conclusions.\n\n"
          "— Data Profiling Manager"
    )
    send_email(recipient, f"[{dataset}] Data Profiling Report — {started:%Y-%m-%d}", body, report_path)

    snapshot = create_snapshot(
        df,
        dataset_id=row["dataset_id"],
        dataset_name=dataset,
        source_name=source,
        owner=row.get("recipient_name", ""),
    )
    snapshot["ai_summary"] = summary
    snapshot["report_path"] = str(report_path)
    snapshot["run_source"] = "scheduled"
    append_jsonl(HISTORY_FILE, snapshot)

    return {
        "timestamp_utc": started.isoformat(timespec="seconds"),
        "run_id": snapshot["run_id"],
        "dataset": dataset,
        "recipient": recipient,
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "report_path": str(report_path),
        "status": "sent",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Process every configured dataset.")
    parser.add_argument("--cron", help="Process rows whose configured cron matches this value.")
    parser.add_argument("--dataset", help="Process one dataset ID or exact dataset name.")
    args = parser.parse_args()

    try:
        selected = select_rows(load_config(), args)
    except Exception as exc:
        print(f"Configuration error: {exc}")
        return 2
    if not selected:
        print("No datasets matched this run.")
        return 0

    entries: list[dict[str, Any]] = []
    for row in selected:
        try:
            entry = process(row)
            print(f"{row['dataset']}: sent to {row['recipient_email']}")
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
    return 1 if any(entry["status"] != "sent" for entry in entries) else 0


if __name__ == "__main__":
    raise SystemExit(main())
