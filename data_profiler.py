"""
Data Profiler — Basic + Advanced Profiling, exported to a clean Excel report.

Usage:
    python data_profiler.py your_data.csv
    python data_profiler.py your_data.csv my_report.xlsx

Output: a multi-tab, color-coded .xlsx with Overview, Basic Profile,
Advanced Profile, and Correlation Matrix tabs.
"""

import re
import sys
from datetime import datetime

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

# ---------- Brand styling ----------
HEADER_FILL = PatternFill("solid", fgColor="6C72CB")
TITLE_FILL = PatternFill("solid", fgColor="2D2A6E")
STRIPE_FILL = PatternFill("solid", fgColor="EEF0FB")
HEADER_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=11)
TITLE_FONT = Font(color="FFFFFF", bold=True, name="Calibri", size=16)
SUBTITLE_FONT = Font(color="6C72CB", italic=True, name="Calibri", size=10)
THIN = Side(style="thin", color="D9D9D9")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def style_header_row(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER


def write_df(ws, df, start_row=1, stripe=True):
    for j, col in enumerate(df.columns, 1):
        ws.cell(row=start_row, column=j, value=col)
    style_header_row(ws, start_row, len(df.columns))
    for i, row in enumerate(df.itertuples(index=False), start_row + 1):
        for j, val in enumerate(row, 1):
            if isinstance(val, np.integer):
                val = int(val)
            elif isinstance(val, np.floating):
                val = float(val)
            elif pd.isna(val):
                val = None
            cell = ws.cell(row=i, column=j, value=val)
            cell.border = BORDER
            if stripe and (i - start_row) % 2 == 0:
                cell.fill = STRIPE_FILL
    return start_row + len(df)


def autofit(ws, max_width=42):
    from openpyxl.utils import get_column_letter

    for idx in range(1, ws.max_column + 1):
        length = 8
        for row in range(1, ws.max_row + 1):
            cell = ws.cell(row=row, column=idx)
            if cell.value is not None:
                length = max(length, len(str(cell.value)))
        ws.column_dimensions[get_column_letter(idx)].width = min(length + 2, max_width)


def add_title(ws, title, subtitle, ncols):
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


# ---------- Profiling logic ----------
def basic_profile(df):
    rows = []
    for col in df.columns:
        s = df[col]
        is_num = pd.api.types.is_numeric_dtype(s)
        mode = s.mode()
        rows.append({
            "Column": col,
            "Dtype": str(s.dtype),
            "Count": int(s.count()),
            "Missing": int(s.isnull().sum()),
            "Missing %": round(s.isnull().mean() * 100, 2),
            "Unique": int(s.nunique()),
            "Unique %": round(s.nunique() / len(s) * 100, 2) if len(s) else 0,
            "Top Value": str(mode.iloc[0]) if not mode.empty else None,
            "Top Freq": int(s.value_counts().iloc[0]) if s.count() else 0,
            "Mean": round(float(s.mean()), 2) if is_num and s.count() else None,
            "Std": round(float(s.std()), 2) if is_num and s.count() else None,
            "Min": (s.min() if is_num else str(s.dropna().astype(str).min())) if s.count() else None,
            "Max": (s.max() if is_num else str(s.dropna().astype(str).max())) if s.count() else None,
        })
    return pd.DataFrame(rows)


def advanced_profile(df):
    rows = []
    for col in df.columns:
        s = df[col]
        is_num = pd.api.types.is_numeric_dtype(s)
        outliers = skew = kurt = None
        if is_num and s.count() > 1:
            q1, q3 = s.quantile([0.25, 0.75])
            iqr = q3 - q1
            outliers = int(((s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)).sum())
            skew = round(float(s.skew()), 2)
            kurt = round(float(s.kurt()), 2)
        card_ratio = round(s.nunique() / len(s), 3) if len(s) else 0
        if s.nunique() <= 1:
            key_flag = "Constant"
        elif card_ratio > 0.95:
            key_flag = "Likely Key"
        else:
            key_flag = "Categorical/Other"
        pattern_pct = None
        if s.dtype == object and s.count():
            patterns = s.dropna().astype(str).apply(
                lambda x: re.sub(r"[A-Za-z]", "A", re.sub(r"\d", "9", x))
            )
            vc = patterns.value_counts(normalize=True)
            pattern_pct = round(float(vc.iloc[0]) * 100, 1) if len(vc) else None
        rows.append({
            "Column": col,
            "Outlier Count (IQR)": outliers,
            "Skewness": skew,
            "Kurtosis": kurt,
            "Cardinality Ratio": card_ratio,
            "Key Candidate Flag": key_flag,
            "Dominant Pattern %": pattern_pct,
        })
    return pd.DataFrame(rows)


def correlation_matrix(df):
    num_df = df.select_dtypes(include=np.number)
    if num_df.shape[1] < 2:
        return None
    corr = num_df.corr().round(2)
    corr.insert(0, "Column", corr.index)
    return corr.reset_index(drop=True)


# ---------- Report builder ----------
def build_report(df, source_name, out_path):
    wb = Workbook()

    ws = wb.active
    ws.title = "Overview"
    add_title(
        ws,
        "Data Profiling Report",
        f"{source_name}  •  generated {datetime.now():%Y-%m-%d %H:%M}",
        2,
    )
    overview = pd.DataFrame({
        "Metric": [
            "Rows",
            "Columns",
            "Memory Usage (MB)",
            "Duplicate Rows",
            "Total Missing Cells",
            "Overall Missing %",
            "Numeric Columns",
            "Categorical Columns",
        ],
        "Value": [
            len(df),
            df.shape[1],
            round(df.memory_usage(deep=True).sum() / 1e6, 2),
            int(df.duplicated().sum()),
            int(df.isnull().sum().sum()),
            round(df.isnull().sum().sum() / df.size * 100, 2) if df.size else 0,
            df.select_dtypes(include=np.number).shape[1],
            df.select_dtypes(exclude=np.number).shape[1],
        ],
    })
    write_df(ws, overview, start_row=4)
    autofit(ws)

    bp = basic_profile(df)
    ws_b = wb.create_sheet("Basic Profile")
    add_title(ws_b, "Basic Profile", "Completeness, uniqueness, central tendency", len(bp.columns))
    write_df(ws_b, bp, start_row=4)
    autofit(ws_b)
    miss_col = bp.columns.get_loc("Missing %") + 1
    rng = f"{ws_b.cell(row=5, column=miss_col).coordinate}:{ws_b.cell(row=4 + len(bp), column=miss_col).coordinate}"
    ws_b.conditional_formatting.add(
        rng,
        ColorScaleRule(
            start_type="min",
            start_color="63BE7B",
            mid_type="percentile",
            mid_value=50,
            mid_color="FFEB84",
            end_type="max",
            end_color="F8696B",
        ),
    )

    ap = advanced_profile(df)
    ws_a = wb.create_sheet("Advanced Profile")
    add_title(ws_a, "Advanced Profile", "Outliers, distribution shape, key & pattern detection", len(ap.columns))
    write_df(ws_a, ap, start_row=4)
    autofit(ws_a)
    out_col = ap.columns.get_loc("Outlier Count (IQR)") + 1
    rng2 = f"{ws_a.cell(row=5, column=out_col).coordinate}:{ws_a.cell(row=4 + len(ap), column=out_col).coordinate}"
    ws_a.conditional_formatting.add(
        rng2,
        ColorScaleRule(
            start_type="min",
            start_color="63BE7B",
            mid_type="percentile",
            mid_value=50,
            mid_color="FFEB84",
            end_type="max",
            end_color="F8696B",
        ),
    )

    corr = correlation_matrix(df)
    if corr is not None:
        ws_c = wb.create_sheet("Correlation Matrix")
        add_title(ws_c, "Correlation Matrix", "Numeric columns only, Pearson r", len(corr.columns))
        write_df(ws_c, corr, start_row=4, stripe=False)
        autofit(ws_c)
        last_col = len(corr.columns)
        rng3 = f"B5:{ws_c.cell(row=4 + len(corr), column=last_col).coordinate}"
        ws_c.conditional_formatting.add(
            rng3,
            ColorScaleRule(
                start_type="num",
                start_value=-1,
                start_color="F8696B",
                mid_type="num",
                mid_value=0,
                mid_color="FFFFFF",
                end_type="num",
                end_value=1,
                end_color="63BE7B",
            ),
        )

    wb.save(out_path)
    return out_path


def main():
    if len(sys.argv) < 2:
        print("Usage: python data_profiler.py your_data.csv [output.xlsx]")
        sys.exit(1)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "data_profiling_report.xlsx"
    df = pd.read_csv(src)
    path = build_report(df, src, out)
    print(f"Report saved to {path}")


if __name__ == "__main__":
    main()
