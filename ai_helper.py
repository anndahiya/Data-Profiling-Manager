"""Gemini helpers shared by the Streamlit app and scheduled agent."""
from __future__ import annotations

import json

import pandas as pd

from data_profiler import advanced_profile, basic_profile


def safe_json_value(value):
    if pd.isna(value):
        return None
    if hasattr(value, "item"):
        value = value.item()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def build_ai_payload(df: pd.DataFrame, source_name: str) -> dict:
    """Build an aggregate-only payload. No raw records or sample values."""
    basic = basic_profile(df)
    advanced = advanced_profile(df)
    missing = [
        {
            "column": row["Column"],
            "dtype": row["Dtype"],
            "missing_count": int(row["Missing"]),
            "missing_percent": float(row["Missing %"]),
            "unique_count": int(row["Unique"]),
        }
        for _, row in basic.sort_values("Missing %", ascending=False).head(15).iterrows()
        if float(row["Missing %"]) > 0
    ]
    outliers = [
        {
            "column": row["Column"],
            "outlier_count_iqr": int(row["Outlier Count (IQR)"]),
            "skewness": safe_json_value(row["Skewness"]),
        }
        for _, row in advanced.sort_values("Outlier Count (IQR)", ascending=False).head(10).iterrows()
        if pd.notna(row["Outlier Count (IQR)"]) and int(row["Outlier Count (IQR)"]) > 0
    ]
    return {
        "dataset_name": source_name,
        "rows": int(len(df)),
        "columns": int(df.shape[1]),
        "memory_mb": round(float(df.memory_usage(deep=True).sum() / 1_000_000), 2),
        "duplicate_rows": int(df.duplicated().sum()),
        "total_missing_cells": int(df.isna().sum().sum()),
        "overall_missing_percent": round(float(df.isna().sum().sum() / df.size * 100), 2) if df.size else 0,
        "column_type_counts": {str(dtype): int(count) for dtype, count in df.dtypes.astype(str).value_counts().items()},
        "columns_with_most_missing_values": missing,
        "numeric_columns_with_outliers": outliers,
        "constant_columns": advanced.loc[advanced["Key Candidate Flag"] == "Constant", "Column"].astype(str).tolist(),
        "likely_key_columns": advanced.loc[advanced["Key Candidate Flag"] == "Likely Key", "Column"].astype(str).tolist(),
    }


def generate_gemini_summary(api_key: str, payload: dict, model: str) -> str:
    from google import genai

    client = genai.Client(api_key=api_key)
    prompt = f"""
You are explaining deterministic data-profiling results to a data analyst or dataset owner.
Use only the supplied aggregate metrics. Do not claim that the dataset is good, bad, compliant,
or fit for purpose. Do not invent causes. Clearly distinguish facts from questions worth investigating.

Write:
1. A concise overview in 2-3 sentences.
2. "Notable observations" with up to 5 bullets.
3. "Questions to investigate" with up to 4 bullets.
4. A one-sentence privacy reminder that the explanation used aggregate metrics, not raw rows.

Profiling metrics:
{json.dumps(payload, indent=2)}
""".strip()
    response = client.models.generate_content(model=model, contents=prompt)
    if not response.text:
        raise RuntimeError("Gemini returned an empty response.")
    return response.text
