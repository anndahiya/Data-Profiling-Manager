"""Deterministic data profiling and Excel report generation.

Usage:
    python data_profiler.py your_data.csv
    python data_profiler.py your_data.csv my_report.xlsx

The workbook contains Overview, Basic Profile, Advanced Profile, and an optional
Correlation Matrix. It intentionally does not calculate a data quality score.
"""
from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

HEADER_FILL = PatternFill("solid", fgColor="6C72CB")
TITLE_FILL = PatternFill("solid", fgColor="2D2A6E")
STRIPE_FILL = PatternFill("solid", fgColor="EEF0FB")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=11)
TITLE_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=16)
SUBTITLE_FONT = Font(color="6C72CB", italic=True, name="Calibri", size=10)
THIN = Side(style="thin", color="D9D9D9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def style_header_row(ws, row: int, ncols: int) -> None:
    for column in range(1, ncols + 1):
        cell = ws.cell(row=row, column=column)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER


def write_df(ws, df: pd.DataFrame, start_row: int = 1, stripe: bool = True) -> int:
    for j, column in enumerate(df.columns, 1):
        ws.cell(row=start_row, column=j, value=column)
    style_header_row(ws, start_row, len(df.columns))
    for i, row in enumerate(df.itertuples(index=False), start_row + 1):
        for j, value in enumerate(row, 1):
            if isinstance(value, np.integer):
                value = int(value)
            elif isinstance(value, np.floating):
                value = float(value)
            elif pd.isna(value):
                value = None
            cell = ws.cell(row=i, column=j, value=value)
            cell.border = BORDER
            if stripe and (i - start_row) % 2 == 0:
                cell.fill = STRIPE_FILL
    return start_row + len(df)


def autofit(ws, max_width: int = 42) -> None:
    from openpyxl.utils import get_column_letter
    for index in range(1, ws.max_column + 1):
        length = 8
        for row in range(1, ws.max_row + 1):
            value = ws.cell(row=row, column=index).value
            if value is not None:
                length = max(length, len(str(value)))
        ws.column_dimensions[get_column_letter(index)].width = min(length + 2, max_width)


def add_title(ws, title: str, subtitle: str, ncols: int) -> None:
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncols)
    cell = ws.cell(row=1, column=1, value=title)
    cell.fill = TITLE_FILL
    cell.font = TITLE_FONT
    cell.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.row_dimensions[1].height = 30
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncols)
    sub = ws.cell(row=2, column=1, value=subtitle)
    sub.font = SUBTITLE_FONT
    sub.alignment = Alignment(horizontal="left", indent=1)


def basic_profile(df: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict] = []
    for column in df.columns:
        series = df[column]
        is_numeric = pd.api.types.is_numeric_dtype(series)
        mode = series.mode(dropna=True)
        non_null_strings = series.dropna().astype(str)
        rows.append({
            "Column": str(column),
            "Dtype": str(series.dtype),
            "Count": int(series.count()),
            "Missing": int(series.isnull().sum()),
            "Missing %": round(float(series.isnull().mean() * 100), 2),
            "Unique": int(series.nunique(dropna=True)),
            "Unique %": round(float(series.nunique(dropna=True) / len(series) * 100), 2) if len(series) else 0,
            "Top Value": str(mode.iloc[0]) if not mode.empty else None,
            "Top Freq": int(series.value_counts(dropna=True).iloc[0]) if series.count() else 0,
            "Mean": round(float(series.mean()), 2) if is_numeric and series.count() else None,
            "Std": round(float(series.std()), 2) if is_numeric and series.count() > 1 else None,
            "Min": series.min() if is_numeric and series.count() else (non_null_strings.min() if len(non_null_strings) else None),
            "Max": series.max() if is_numeric and series.count() else (non_null_strings.max() if len(non_null_strings) else None),
        })
    return pd.DataFrame(rows)


def advanced_profile(df: pd.DataFrame) -> pd.DataFrame:
    rows: list[dict] = []
    for column in df.columns:
        series = df[column]
        is_numeric = pd.api.types.is_numeric_dtype(series)
        outliers = skew = kurt = None
        if is_numeric and series.count() > 1:
            q1, q3 = series.quantile([0.25, 0.75])
            iqr = q3 - q1
            outliers = int(((series < q1 - 1.5 * iqr) | (series > q3 + 1.5 * iqr)).sum())
            skew_value = series.skew()
            kurt_value = series.kurt()
            skew = round(float(skew_value), 2) if pd.notna(skew_value) else None
            kurt = round(float(kurt_value), 2) if pd.notna(kurt_value) else None
        cardinality_ratio = round(float(series.nunique(dropna=True) / len(series)), 3) if len(series) else 0
        if series.nunique(dropna=True) <= 1:
            key_flag = "Constant"
        elif cardinality_ratio > 0.95:
            key_flag = "Likely Key"
        else:
            key_flag = "Categorical/Other"
        pattern_percent = None
        if not is_numeric and series.count():
            patterns = series.dropna().astype(str).apply(lambda value: re.sub(r"[A-Za-z]", "A", re.sub(r"\d", "9", value)))
            frequencies = patterns.value_counts(normalize=True)
            pattern_percent = round(float(frequencies.iloc[0]) * 100, 1) if len(frequencies) else None
        rows.append({
            "Column": str(column),
            "Outlier Count (IQR)": outliers,
            "Skewness": skew,
            "Kurtosis": kurt,
            "Cardinality Ratio": cardinality_ratio,
            "Key Candidate Flag": key_flag,
            "Dominant Pattern %": pattern_percent,
        })
    return pd.DataFrame(rows)


def correlation_matrix(df: pd.DataFrame) -> pd.DataFrame | None:
    numeric = df.select_dtypes(include=np.number)
    if numeric.shape[1] < 2:
        return None
    correlation = numeric.corr().round(2)
    correlation.insert(0, "Column", correlation.index.astype(str))
    return correlation.reset_index(drop=True)


def build_report(df: pd.DataFrame, source_name: str, out_path: str) -> str:
    workbook = Workbook()
    overview_sheet = workbook.active
    overview_sheet.title = "Overview"
    add_title(overview_sheet, "Data Profiling Report", f"{source_name}  •  generated {datetime.now():%Y-%m-%d %H:%M}", 2)
    overview = pd.DataFrame({
        "Metric": ["Rows", "Columns", "Memory Usage (MB)", "Duplicate Rows", "Total Missing Cells", "Overall Missing %", "Numeric Columns", "Other Columns"],
        "Value": [
            len(df),
            df.shape[1],
            round(float(df.memory_usage(deep=True).sum() / 1_000_000), 2),
            int(df.duplicated().sum()),
            int(df.isnull().sum().sum()),
            round(float(df.isnull().sum().sum() / df.size * 100), 2) if df.size else 0,
            df.select_dtypes(include=np.number).shape[1],
            df.select_dtypes(exclude=np.number).shape[1],
        ],
    })
    write_df(overview_sheet, overview, start_row=4)
    autofit(overview_sheet)

    basic = basic_profile(df)
    basic_sheet = workbook.create_sheet("Basic Profile")
    add_title(basic_sheet, "Basic Profile", "Completeness, uniqueness, frequency, and range", len(basic.columns))
    write_df(basic_sheet, basic, start_row=4)
    autofit(basic_sheet)
    missing_column = basic.columns.get_loc("Missing %") + 1
    if len(basic):
        missing_range = f"{basic_sheet.cell(row=5, column=missing_column).coordinate}:{basic_sheet.cell(row=4 + len(basic), column=missing_column).coordinate}"
        basic_sheet.conditional_formatting.add(missing_range, ColorScaleRule(start_type="min", start_color="63BE7B", mid_type="percentile", mid_value=50, mid_color="FFEB84", end_type="max", end_color="F8696B"))

    advanced = advanced_profile(df)
    advanced_sheet = workbook.create_sheet("Advanced Profile")
    add_title(advanced_sheet, "Advanced Profile", "Outliers, distribution shape, key candidates, and patterns", len(advanced.columns))
    write_df(advanced_sheet, advanced, start_row=4)
    autofit(advanced_sheet)
    outlier_column = advanced.columns.get_loc("Outlier Count (IQR)") + 1
    if len(advanced):
        outlier_range = f"{advanced_sheet.cell(row=5, column=outlier_column).coordinate}:{advanced_sheet.cell(row=4 + len(advanced), column=outlier_column).coordinate}"
        advanced_sheet.conditional_formatting.add(outlier_range, ColorScaleRule(start_type="min", start_color="63BE7B", mid_type="percentile", mid_value=50, mid_color="FFEB84", end_type="max", end_color="F8696B"))

    correlation = correlation_matrix(df)
    if correlation is not None:
        correlation_sheet = workbook.create_sheet("Correlation Matrix")
        add_title(correlation_sheet, "Correlation Matrix", "Numeric columns only, Pearson correlation", len(correlation.columns))
        write_df(correlation_sheet, correlation, start_row=4, stripe=False)
        autofit(correlation_sheet)
        last_column = len(correlation.columns)
        correlation_range = f"B5:{correlation_sheet.cell(row=4 + len(correlation), column=last_column).coordinate}"
        correlation_sheet.conditional_formatting.add(correlation_range, ColorScaleRule(start_type="num", start_value=-1, start_color="F8696B", mid_type="num", mid_value=0, mid_color="FFFFFF", end_type="num", end_value=1, end_color="63BE7B"))

    workbook.save(out_path)
    return out_path


def read_table(path: str) -> pd.DataFrame:
    suffix = Path(path).suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in {".xlsx", ".xls"}:
        return pd.read_excel(path)
    if suffix == ".parquet":
        return pd.read_parquet(path)
    raise ValueError("Supported files are CSV, Excel, and Parquet.")


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python data_profiler.py your_data.csv [output.xlsx]")
        return 1
    source = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else "data_profiling_report.xlsx"
    data = read_table(source)
    build_report(data, source, output)
    print(f"Report saved to {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
