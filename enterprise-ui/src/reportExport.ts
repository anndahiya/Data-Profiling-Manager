import * as XLSX from 'xlsx';
import { recordComplianceScore } from './scoring';
import type { Dataset, Issue, ProfileRun } from './types';

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'data_asset';
}

function appendSheet(workbook: XLSX.WorkBook, name: string, rows: Array<Record<string, unknown>>, widths: number[] = []) {
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Message: 'No rows available' }]);
  if (widths.length) sheet['!cols'] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

export function downloadDataQualityReport(dataset: Dataset, run: ProfileRun, issues: Issue[]): void {
  const workbook = XLSX.utils.book_new();
  const strict = recordComplianceScore(run.quality);

  appendSheet(workbook, 'Overview', [
    { Metric: 'Data asset', Value: dataset.name },
    { Metric: 'Owner', Value: dataset.owner || 'Not assigned' },
    { Metric: 'Source', Value: run.fileName },
    { Metric: 'Profiled at', Value: run.createdAt },
    { Metric: 'Rows', Value: run.rowCount },
    { Metric: 'Columns', Value: run.columnCount },
    { Metric: 'Duplicate rows', Value: run.duplicateRows },
    { Metric: 'Missing cells', Value: run.missingCells },
    { Metric: 'Missing cells %', Value: Number(run.missingPercentage.toFixed(2)) },
    { Metric: 'Overall data quality %', Value: Number(run.quality.overallScore.toFixed(2)) },
    { Metric: 'Strict record compliance %', Value: Number(strict.toFixed(2)) },
    { Metric: 'Rules evaluated', Value: run.quality.rulesEvaluated },
    { Metric: 'Open issues from this run', Value: issues.filter((issue) => issue.status === 'Open').length },
  ], [30, 42]);

  appendSheet(workbook, 'Column Profile', run.columns.map((column) => ({
    Column: column.name,
    'Inferred type': column.inferredType,
    'Non-null count': column.nonNullCount,
    'Missing count': column.missingCount,
    'Missing %': Number(column.missingPercentage.toFixed(2)),
    'Distinct values': column.distinctCount,
    'Unique values': column.uniqueCount,
    'Unique %': Number(column.uniquenessPercentage.toFixed(2)),
    'Duplicate value count': column.duplicateValueCount,
    'Outlier count': column.outlierCount,
    'Likely key': column.likelyKey ? 'Yes' : 'No',
    'Dominant pattern': column.dominantPattern ?? '',
    'Dominant pattern %': column.dominantPatternPercentage === undefined ? '' : Number(column.dominantPatternPercentage.toFixed(2)),
    Minimum: column.numericStats?.min ?? '',
    Maximum: column.numericStats?.max ?? '',
    Mean: column.numericStats?.mean === undefined ? '' : Number(column.numericStats.mean.toFixed(4)),
    Median: column.numericStats?.median === undefined ? '' : Number(column.numericStats.median.toFixed(4)),
    'Standard deviation': column.numericStats?.standardDeviation === undefined ? '' : Number(column.numericStats.standardDeviation.toFixed(4)),
    Q1: column.numericStats?.q1 === undefined ? '' : Number(column.numericStats.q1.toFixed(4)),
    Q3: column.numericStats?.q3 === undefined ? '' : Number(column.numericStats.q3.toFixed(4)),
  })), [28, 15, 15, 15, 12, 16, 14, 12, 20, 14, 12, 24, 20, 14, 14, 14, 14, 20, 14, 14]);

  appendSheet(workbook, 'DQ Dimensions', run.quality.dimensions.map((dimension) => ({
    Dimension: dimension.dimension,
    'Score %': Number(dimension.score.toFixed(2)),
    Weight: dimension.weight ?? '',
    'Active rules': dimension.activeRules,
    'Passing records': dimension.passingRecords,
    'Failing records': dimension.failingRecords,
  })), [24, 12, 12, 14, 18, 18]);

  appendSheet(workbook, 'DQ Rules', (run.quality.ruleResults ?? []).map((rule) => ({
    Rule: rule.ruleName,
    Dimension: rule.dimension,
    Severity: rule.severity,
    'Score %': Number(rule.score.toFixed(2)),
    'Threshold %': Number(rule.threshold.toFixed(2)),
    Weight: rule.weight,
    'Passing records': rule.passingRecords,
    'Failing records': rule.failingRecords,
    Status: rule.score >= rule.threshold ? 'Passed' : 'Breached',
  })), [34, 22, 12, 12, 14, 10, 18, 18, 12]);

  appendSheet(workbook, 'Issues', issues.map((issue) => ({
    Category: issue.category,
    Severity: issue.severity,
    Status: issue.status,
    Title: issue.title,
    Description: issue.description,
    Metric: issue.metric ?? '',
    'Current value': issue.currentValue ?? '',
    'Previous value': issue.previousValue ?? '',
    'Created at': issue.createdAt,
  })), [20, 12, 14, 36, 70, 22, 18, 18, 24]);

  XLSX.writeFile(workbook, `${safeFileName(dataset.name)}_${run.createdAt.slice(0, 10)}_data_quality_report.xlsx`, { compression: true });
}

export function downloadTechnicalProfile(dataset: Dataset, run: ProfileRun, issues: Issue[]): void {
  const blob = new Blob([JSON.stringify({ dataset, run, issues }, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${safeFileName(dataset.name)}_${run.createdAt.slice(0, 10)}_profile.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
