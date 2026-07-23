"""Scheduled profiling and email runner for Data Profiling Manager.

The runner reads schedule_config.csv, profiles matching datasets, optionally
creates a Gemini explanation from aggregate metrics, and emails the Excel report.

Examples:
    python monthly_profiling_agent.py --all
    python monthly_profiling_agent.py --cron "15 7 1 * *"
    python monthly_profiling_agent.py --dataset customer-master

Required environment variables for email:
    SMTP_HOST
    SMTP_PORT          defaults to 587
    SMTP_USER
    SMTP_PASS

Optional:
    GEMINI_API_KEY
    GEMINI_MODEL       defaults to gemini-2.5-flash
"""
from __future__ import annotations

import argparse
import json
import os
import smtplib
import tempfile
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import pandas as pd

from ai_helper import build_ai_payload, generate_gemini_summary
from data_profiler import build_report
from schedule_helper import cadence_to_cron

CONFIG_FILE = Path("schedule_config.csv")
LEGACY_CONFIG_FILE = Path("steward_map.csv")
LOG_FILE = Path("run_log.jsonl")


def parse_bool(value: Any) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def normalize_row(row: pd.Series) -> dict[str, Any]:
    source = row.get("source") or row.get("file_path")
    recipient_name = row.get("recipient_name") or row.get("steward_name") or "there"
    recipient_email = row.get("recipient_email") or row.get("steward_email")
    dataset = str(row.get("dataset") or "dataset")
    return {
        "dataset_id": str(row.get("dataset_id") or dataset).strip().lower().replace(" ", "-"),
        "dataset": dataset,
        "source": str(source or ""),
        "recipient_name": str(recipient_name),
        "recipient_email": str(recipient_email or ""),
        "cadence": str(row.get("cadence") or "Monthly"),
        "weekday": str(row.get("weekday") or "Monday"),
        "day_of_month": int(row.get("day_of_month") or 1),
        "month": int(row.get("month") or 1),
        "hour_utc": int(row.get("hour_utc") or row.get("hour_24") or 7),
        "minute": int(row.get("minute") or 15),
        "ai_summary": parse_bool(row.get("ai_summary", False)),
        "cron": str(row.get("cron") or "").strip(),
    }


def load_config() -> list[dict[str, Any]]:
    path = CONFIG_FILE if CONFIG_FILE.exists() else LEGACY_CONFIG_FILE
    if not path.exists():
        raise FileNotFoundError("No schedule_config.csv or steward_map.csv was found.")
    frame = pd.read_csv(path).fillna("")
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


def process(row: dict[str, Any]) -> dict[str, Any]:
    started = datetime.now(timezone.utc)
    dataset = row["dataset"]
    source = row["source"]
    recipient = row["recipient_email"]
    if not source or not recipient:
        raise ValueError("The source and recipient email are required.")

    df = read_source(source)
    safe_name = "".join(character if character.isalnum() or character in "-_" else "_" for character in dataset)
    with tempfile.TemporaryDirectory() as temp_dir:
        report_path = Path(temp_dir) / f"{safe_name}_profiling_{started:%Y-%m-%d}.xlsx"
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

    return {
        "timestamp_utc": started.isoformat(timespec="seconds"),
        "dataset": dataset,
        "recipient": recipient,
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "status": "sent",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--all", action="store_true", help="Process every configured dataset.")
    parser.add_argument("--cron", help="Process rows whose configured cron matches this value.")
    parser.add_argument("--dataset", help="Process one dataset ID or exact dataset name.")
    args = parser.parse_args()

    entries: list[dict[str, Any]] = []
    try:
        selected = select_rows(load_config(), args)
    except Exception as exc:
        print(f"Configuration error: {exc}")
        return 2

    if not selected:
        print("No datasets matched this run.")
        return 0

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

    with LOG_FILE.open("a", encoding="utf-8") as file:
        for entry in entries:
            file.write(json.dumps(entry) + "\n")

    return 1 if any(entry["status"] != "sent" for entry in entries) else 0


if __name__ == "__main__":
    raise SystemExit(main())