"""Evaluate exported governed data-quality rules for scheduled profiling."""
from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import pandas as pd

NULL_LIKE = {"", "null", "none", "n/a", "na", "nan", "unknown", "(blank)"}


def _is_null_like(value: Any) -> bool:
    if value is None:
        return True
    try:
        if pd.isna(value):
            return True
    except (TypeError, ValueError):
        pass
    return isinstance(value, str) and value.strip().lower() in NULL_LIKE


def _value_key(value: Any) -> str:
    if _is_null_like(value):
        return "(null)"
    if isinstance(value, (dict, list, tuple, set)):
        return json.dumps(value, sort_keys=True, default=str)
    return str(value)


def _pattern_for(value: Any) -> str:
    if _is_null_like(value):
        return "(null)"
    text = str(value).strip()
    text = re.sub(r"[A-Z]", "A", text)
    text = re.sub(r"[a-z]", "a", text)
    text = re.sub(r"\d", "9", text)
    return re.sub(r"\s+", " ", text)


def _infer_type(value: Any) -> str:
    if _is_null_like(value):
        return "empty"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int) and not isinstance(value, bool):
        return "integer"
    if isinstance(value, float):
        return "integer" if value.is_integer() else "decimal"
    if isinstance(value, pd.Timestamp):
        return "date"
    text = str(value).strip()
    if re.fullmatch(r"(?i:true|false|yes|no)", text):
        return "boolean"
    if re.fullmatch(r"-?\d+", text):
        return "integer"
    if re.fullmatch(r"-?(?:\d+\.\d+|\d+e[+-]?\d+)", text, flags=re.I):
        return "decimal"
    date_shaped = bool(
        re.fullmatch(r"(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:[ T].*)?", text)
        or re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?", text, flags=re.I)
    )
    if date_shaped and not pd.isna(pd.to_datetime(text, errors="coerce", utc=True)):
        return "date"
    return "text"


def _optional_float(value: Any) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        parsed = float(value)
        return parsed if math.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def _number_or_default(value: Any, default: float) -> float:
    parsed = _optional_float(value)
    return default if parsed is None else parsed


def _evaluate_rule(frame: pd.DataFrame, rule: dict[str, Any]) -> pd.Series:
    column = str(rule.get("columnName") or "")
    if column not in frame.columns:
        raise ValueError(f"Rule {rule.get('name')!r} references missing column {column!r}.")
    values = frame[column]
    rule_type = str(rule.get("ruleType") or "")
    expected = str(rule.get("expectedValue") or "")
    secondary = str(rule.get("secondaryValue") or "")

    if rule_type == "unique":
        keys = values.map(_value_key)
        counts = keys[keys != "(null)"].value_counts(dropna=False)
        return keys.map(lambda key: key != "(null)" and int(counts.get(key, 0)) == 1)

    def passes(value: Any) -> bool:
        if rule_type == "not-null":
            return not _is_null_like(value)
        if _is_null_like(value):
            return True
        text = str(value).strip()
        if rule_type == "type":
            observed = _infer_type(value)
            return observed == expected or (expected == "decimal" and observed == "integer")
        if rule_type == "pattern":
            try:
                return bool(re.search(expected, text)) or _pattern_for(value) == expected
            except re.error:
                return _pattern_for(value) == expected
        if rule_type == "freshness":
            days = max(0.0, _number_or_default(expected, 30.0))
            timestamp = pd.to_datetime(value, errors="coerce", utc=True)
            if pd.isna(timestamp):
                return False
            threshold = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=days)
            return bool(timestamp >= threshold)
        if rule_type == "range":
            try:
                numeric = float(value)
            except (TypeError, ValueError):
                return False
            minimum = _optional_float(expected)
            maximum = _optional_float(secondary)
            return (minimum is None or numeric >= minimum) and (maximum is None or numeric <= maximum)
        if rule_type == "allowed-values":
            allowed = {item.strip().lower() for item in expected.split(",") if item.strip()}
            return text.lower() in allowed
        if rule_type == "min-length":
            return len(text) >= int(_number_or_default(expected, 0.0))
        if rule_type == "max-length":
            maximum = _optional_float(expected)
            return len(text) <= int(maximum if maximum is not None else 2**31 - 1)
        return True

    return values.map(passes).astype(bool)


def load_quality_config(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    parsed = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("quality_config.json must contain a JSON object.")
    if not isinstance(parsed.get("rules", []), list) or not isinstance(parsed.get("dimensions", []), list):
        raise ValueError("quality_config.json must contain rules and dimensions arrays.")
    return parsed


def evaluate_quality(frame: pd.DataFrame, dataset_id: str, config: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return weighted quality and strict record compliance, or None when no governed rules exist."""
    if not config:
        return None
    dimension_definitions = {
        str(item.get("name", "")).strip().lower(): item
        for item in config.get("dimensions", [])
        if item.get("enabled", True) and str(item.get("name", "")).strip()
    }
    rules = [
        rule for rule in config.get("rules", [])
        if str(rule.get("datasetId")) == dataset_id
        and rule.get("enabled", True)
        and str(rule.get("dimension", "")).strip().lower() in dimension_definitions
    ]
    if not rules:
        return None

    evaluations: list[dict[str, Any]] = []
    for rule in rules:
        passes = _evaluate_rule(frame, rule)
        passing = int(passes.sum())
        total = int(len(frame))
        evaluations.append({
            "rule": rule,
            "passes": passes,
            "score": (passing / total * 100.0) if total else 100.0,
            "passing_records": passing,
            "failing_records": total - passing,
            "weight": max(0.0, _number_or_default(rule.get("weight"), 1.0)),
            "threshold": min(100.0, max(0.0, _number_or_default(rule.get("threshold"), 95.0))),
            "severity": str(rule.get("severity") or "Medium"),
        })

    dimensions: list[dict[str, Any]] = []
    dimension_names: list[str] = []
    for item in evaluations:
        name = str(item["rule"].get("dimension"))
        if name not in dimension_names:
            dimension_names.append(name)
    for name in dimension_names:
        items = [item for item in evaluations if str(item["rule"].get("dimension")) == name]
        rule_weight = sum(float(item["weight"]) for item in items)
        score = sum(float(item["score"]) * float(item["weight"]) for item in items) / rule_weight if rule_weight else 100.0
        strict_passes = pd.concat([item["passes"].rename(str(index)) for index, item in enumerate(items)], axis=1).all(axis=1)
        definition = dimension_definitions[name.lower()]
        dimensions.append({
            "dimension": name,
            "score": score,
            "weight": max(0.0, _number_or_default(definition.get("weight"), 1.0)),
            "active_rules": len(items),
            "passing_records": int(strict_passes.sum()),
            "failing_records": int(len(frame) - strict_passes.sum()),
        })

    dimension_weight = sum(float(item["weight"]) for item in dimensions)
    overall = sum(float(item["score"]) * float(item["weight"]) for item in dimensions) / dimension_weight if dimension_weight else 100.0
    all_pass = pd.concat([item["passes"].rename(str(index)) for index, item in enumerate(evaluations)], axis=1).all(axis=1)
    strict = float(all_pass.mean() * 100.0) if len(frame) else 100.0
    return {
        "overall_score": overall,
        "record_compliance_score": strict,
        "passing_records": int(all_pass.sum()),
        "failing_records": int(len(frame) - all_pass.sum()),
        "rules_evaluated": len(evaluations),
        "dimensions": dimensions,
        "rule_results": [
            {
                "rule_id": str(item["rule"].get("id") or ""),
                "rule_name": str(item["rule"].get("name") or "Rule"),
                "dimension": str(item["rule"].get("dimension") or ""),
                "score": float(item["score"]),
                "weight": float(item["weight"]),
                "threshold": float(item["threshold"]),
                "severity": item["severity"],
                "passing_records": int(item["passing_records"]),
                "failing_records": int(item["failing_records"]),
            }
            for item in evaluations
        ],
    }
