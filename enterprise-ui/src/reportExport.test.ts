import { describe, expect, it } from 'vitest';
import { buildDataQualityWorkbook } from './reportExport';
import type { Dataset, Issue, MonitorPolicy, ProfileRun, QualityDimension, QualityRule } from './types';

const dataset: Dataset = {
  id: 'customer',
  name: 'Customer master',
  description: 'Customer records',
  owner: 'Customer Data Office',
  tags: [],
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-24T00:00:00Z',
};

const rule: QualityRule = {
  id: 'rule-email',
  datasetId: 'customer',
  name: 'Email is populated',
  dimension: 'Completeness',
  columnName: 'email',
  ruleType: 'not-null',
  enabled: true,
  source: 'User',
  weight: 1,
  threshold: 95,
  severity: 'High',
  createdAt: '2026-07-01T00:00:00Z',
};

const dimension: QualityDimension = {
  id: 'completeness',
  name: 'Completeness',
  description: 'Required values are present for the intended use.',
  weight: 1,
  enabled: true,
  source: 'Standard',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
};

const run: ProfileRun = {
  id: 'run-2',
  datasetId: 'customer',
  fileName: 'customer_v2.xlsx',
  createdAt: '2026-07-24T00:00:00Z',
  rowCount: 100,
  columnCount: 2,
  duplicateRows: 1,
  missingCells: 10,
  missingPercentage: 5,
  memoryUsageMB: 0.5,
  numericColumnCount: 1,
  otherColumnCount: 1,
  schemaFingerprint: 'customer_id:integer|email:text',
  sourceKind: 'Excel',
  columns: [
    {
      name: 'customer_id', inferredType: 'integer', nonNullCount: 100, missingCount: 0, missingPercentage: 0,
      distinctCount: 100, uniqueCount: 100, duplicateValueCount: 0, uniquenessPercentage: 100, cardinalityRatio: 1,
      outlierCount: 0, likelyKey: true, classification: 'Likely key', topValues: [], patterns: [],
      numericStats: { min: 1, max: 100, mean: 50.5, median: 50.5, standardDeviation: 28.86, q1: 25.75, q3: 75.25 },
    },
    {
      name: 'email', inferredType: 'text', nonNullCount: 90, missingCount: 10, missingPercentage: 10,
      distinctCount: 90, uniqueCount: 90, duplicateValueCount: 0, uniquenessPercentage: 100, cardinalityRatio: .9,
      outlierCount: 0, likelyKey: false, classification: 'Categorical/other',
      dominantPattern: 'aaaa@aaaa.aaa', dominantPatternPercentage: 80,
      topValues: [{ value: 'person@example.com', count: 1, percentage: 1.11 }],
      patterns: [{ pattern: 'aaaa@aaaa.aaa', count: 72, percentage: 80 }],
      textStats: { minLength: 8, maxLength: 40, meanLength: 22 },
    },
  ],
  correlations: [],
  quality: {
    evaluatedRecords: 100,
    passingRecords: 90,
    failingRecords: 10,
    overallScore: 90,
    recordComplianceScore: 90,
    rulesEvaluated: 1,
    scoringMethod: 'weighted-rule-average',
    dimensions: [{ dimension: 'Completeness', passingRecords: 90, failingRecords: 10, score: 90, activeRules: 1, weight: 1 }],
    ruleResults: [{ ruleId: rule.id, ruleName: rule.name, dimension: rule.dimension, passingRecords: 90, failingRecords: 10, score: 90, threshold: 95, weight: 1, severity: 'High' }],
  },
};

const previousRun: ProfileRun = { ...run, id: 'run-1', fileName: 'customer_v1.xlsx', createdAt: '2026-07-23T00:00:00Z', rowCount: 95, missingCells: 5, missingPercentage: 2.63, duplicateRows: 0, quality: { ...run.quality, overallScore: 97, recordComplianceScore: 95 } };

const issue: Issue = {
  id: 'issue-1', datasetId: dataset.id, runId: run.id, category: 'Data quality', severity: 'High', status: 'Open',
  title: 'Email is populated fell below 95%', description: '10 of 100 records failed this completeness rule.',
  createdAt: run.createdAt, metric: rule.name, currentValue: '90.0%', previousValue: 'Threshold 95.0%',
};

const monitor: MonitorPolicy = {
  id: 'monitor-1', datasetId: dataset.id, enabled: true, sourcePath: '/data/customer.xlsx', recipientName: 'Steward', recipientEmail: 'steward@example.com',
  cadence: 'Monthly', weekday: 'Monday', dayOfMonth: 1, month: 1, hourUtc: 7, minute: 0, deliveryMode: 'breach-only', attachReport: true, aiSummary: false,
  minimumOverallQuality: 95, minimumRecordCompliance: 95, maximumMissingPercent: 5, maximumDuplicateRows: 0, maximumRowChangePercent: 20,
  createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-07-01T00:00:00Z',
};

function valuesInSheet(sheetName: string, workbook: ReturnType<typeof buildDataQualityWorkbook>): unknown[] {
  const values: unknown[] = [];
  const sheet = workbook.getWorksheet(sheetName);
  sheet?.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
  return values;
}

describe('formatted data quality report', () => {
  it('creates a styled executive-first workbook with governed context', () => {
    const workbook = buildDataQualityWorkbook({ dataset, run, issues: [issue], previousRun, rules: [rule], dimensions: [dimension], monitor });
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Executive Summary', 'DQ Dimensions', 'DQ Rules', 'Findings & Issues', 'Monitoring Thresholds',
      'Data Profile', 'Column Statistics', 'Correlations', 'Top Values & Patterns',
    ]);
    const summary = workbook.getWorksheet('Executive Summary');
    expect(summary?.getCell('A1').value).toBe('DATA QUALITY REPORT');
    expect(summary?.getCell('A1').fill).toMatchObject({ type: 'pattern' });
    expect(valuesInSheet('Executive Summary', workbook)).toContain('How to read the scores');
    expect(valuesInSheet('DQ Rules', workbook)).toContain('Expected condition');
    expect(valuesInSheet('DQ Rules', workbook)).toContain('Value must be present.');
  });

  it('uses unambiguous profiling terminology instead of calling distinct and one-time values the same thing', () => {
    const workbook = buildDataQualityWorkbook({ dataset, run, issues: [issue], rules: [rule], dimensions: [dimension] });
    const values = valuesInSheet('Data Profile', workbook);
    expect(values).toContain('Distinct values');
    expect(values).toContain('Values appearing once');
    expect(values).toContain('Rows with repeated values');
    expect(values).not.toContain('Unique');
  });
});
