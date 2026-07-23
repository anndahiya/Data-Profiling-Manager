"""Scheduled Data Profiling Agent.

Profiles registered CSV datasets, emails the Excel report to the assigned data
steward/owner, and can optionally add a Gemini explanation based only on
aggregate profiling metrics.

Environment variables:
    SMTP_USER
    SMTP_PASS
    GEMINI_API_KEY       optional
    GEMINI_MODEL         optional; defaults to gemini-2.5-flash
"""
from __future__ import annotations

import json
import os
import smtplib
from datetime import date
from email.message import EmailMessage
from pathlib import Path

import pandas as pd

from ai_helper import build_ai_payload, generate_gemini_summary
from data_profiler import build_report

STEWARD_MAP = "steward_map.csv"
LOG_FILE = "run_log.jsonl"
SENDER = os.environ.get("SMTP_USER", "data-profiling@company.com")


def send_email(to_email: str, subject: str, body: str, attachment_path: str) -> None:
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = subject, SENDER, to_email
    msg.set_content(body)
    with open(attachment_path, "rb") as file:
        msg.add_attachment(
            file.read(),
            maintype="application",
            subtype="vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=Path(attachment_path).name,
        )
    with smtplib.SMTP("smtp.office365.com", 587) as smtp:
        smtp.starttls()
        smtp.login(SENDER, os.environ["SMTP_PASS"])
        smtp.send_message(msg)


def ai_summary(df: pd.DataFrame, dataset_name: str) -> str | None:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    payload = build_ai_payload(df, dataset_name)
    return generate_gemini_summary(api_key, payload, model)


def run() -> None:
    recipients = pd.read_csv(STEWARD_MAP)
    today = date.today().isoformat()
    log_entries: list[dict] = []

    for _, row in recipients.iterrows():
        dataset = row["dataset"]
        source = row["file_path"]
        name = row["steward_name"]
        email = row["steward_email"]
        output_path = f"{dataset}_profiling_{today}.xlsx"

        try:
            df = pd.read_csv(source)
            build_report(df, source, output_path)
            summary = ai_summary(df, dataset)
            body = (
                f"Hi {name},\n\n"
                f"Attached is the {today} data profiling report for {dataset}.\n\n"
                + (f"Gemini explanation based on aggregate profiling metrics:\n\n{summary}\n\n" if summary else "")
                + "The workbook contains factual profiling results. Review the underlying business context before drawing conclusions.\n\n"
                "— Data Profiling Manager"
            )
            send_email(email, f"[{dataset}] Data Profiling Report — {today}", body, output_path)
            log_entries.append({"date": today, "dataset": dataset, "status": "sent", "recipient": email})
            print(f"{dataset}: sent to {email}")
        except Exception as exc:
            log_entries.append({"date": today, "dataset": dataset, "status": f"failed: {exc}", "recipient": email})
            print(f"{dataset}: FAILED — {exc}")

    with open(LOG_FILE, "a", encoding="utf-8") as log_file:
        for entry in log_entries:
            log_file.write(json.dumps(entry) + "\n")

    failures = [entry for entry in log_entries if entry["status"] != "sent"]
    if failures:
        print(f"\n{len(failures)} run(s) failed — check {LOG_FILE}")


if __name__ == "__main__":
    run()
