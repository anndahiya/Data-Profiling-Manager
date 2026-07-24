import { createDefaultDimensions } from './quality';
import type { Dataset, Issue, ProfileRun, QualityRule, RuleResult, WorkspaceSnapshot } from './types';

const now = new Date();
const isoDaysAgo = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();

const dataset: Dataset = {
  id: 'demo-customer-master',
  name: 'Customer master',
  description: 'Golden customer profile used by service, marketing, and analytics teams.',
  owner: 'Customer Data Office',
  tags: ['Customer', 'Critical', 'PII'],
  createdAt: isoDaysAgo(90),
  updatedAt: isoDaysAgo(1),
  latestRunId: 'demo-run-3',
};

const columns = [
  { name: 'customer_id', inferredType: 'integer', missingCount: 0, missingPercentage: 0, distinctCount: 12040, uniqueCount: 12040, duplicateValueCount: 0, uniquenessPercentage: 100, outlierCount: 0, likelyKey: true, topValues: [], patterns: [], nonNullCount: 12040, classification: 'Likely key', cardinalityRatio: 1 },
  { name: 'email', inferredType: 'text', missingCount: 151, missingPercentage: 1.25, distinctCount: 11782, uniqueCount: 11620, duplicateValueCount: 269, uniquenessPercentage: 97.75, outlierCount: 0, likelyKey: false, dominantPattern: 'aaa@aaa.aaa', dominantPatternPercentage: 92.4, topValues: [], patterns: [], nonNullCount: 11889, classification: 'Categorical/other', cardinalityRatio: .98 },
  { name: 'state', inferredType: 'text', missingCount: 480, missingPercentage: 3.99, distinctCount: 51, uniqueCount: 0, duplicateValueCount: 11560, uniquenessPercentage: 0, outlierCount: 0, likelyKey: false, dominantPattern: 'AA', dominantPatternPercentage: 98.6, topValues: [{ value: 'NC', count: 1780, percentage: 15.4 }, { value: 'VA', count: 1420, percentage: 12.3 }], patterns: [{ pattern: 'AA', count: 11400, percentage: 98.6 }], nonNullCount: 11560, classification: 'Categorical/other', cardinalityRatio: .004 },
  { name: 'annual_income', inferredType: 'decimal', missingCount: 38, missingPercentage: 0.32, distinctCount: 11002, uniqueCount: 10110, duplicateValueCount: 1892, uniquenessPercentage: 84.2, outlierCount: 62, likelyKey: false, topValues: [], patterns: [], nonNullCount: 12002, classification: 'Measure', cardinalityRatio: .91, numericStats: { min: 8500, max: 790000, mean: 87920, median: 74200, standardDeviation: 43820, q1: 51200, q3: 104500 } },
  { name: 'updated_at', inferredType: 'date', missingCount: 0, missingPercentage: 0, distinctCount: 26, uniqueCount: 0, duplicateValueCount: 12040, uniquenessPercentage: 0, outlierCount: 0, likelyKey: false, topValues: [], patterns: [], nonNullCount: 12040, classification: 'Date/time', cardinalityRatio: .002 },
] as ProfileRun['columns'];

const rules: QualityRule[] = [
  { id: 'demo-rule-email', datasetId: dataset.id, name: 'Email is populated', dimension: 'Completeness', columnName: 'email', ruleType: 'not-null', enabled: true, source: 'User', weight: 1, threshold: 95, severity: 'High', createdAt: isoDaysAgo(90) },
  { id: 'demo-rule-state', datasetId: dataset.id, name: 'State follows the expected format', dimension: 'Validity', columnName: 'state', ruleType: 'pattern', expectedValue: 'AA', enabled: true, source: 'User', weight: 1, threshold: 95, severity: 'Medium', createdAt: isoDaysAgo(90) },
  { id: 'demo-rule-id', datasetId: dataset.id, name: 'Customer ID is unique', dimension: 'Uniqueness', columnName: 'customer_id', ruleType: 'unique', enabled: true, source: 'User', weight: 1, threshold: 100, severity: 'Critical', createdAt: isoDaysAgo(90) },
  { id: 'demo-rule-freshness', datasetId: dataset.id, name: 'Customer data is no more than 30 days old', dimension: 'Timeliness', columnName: 'updated_at', ruleType: 'freshness', expectedValue: '30', enabled: true, source: 'User', weight: 1, threshold: 95, severity: 'High', createdAt: isoDaysAgo(90) },
];

const allDimensions = createDefaultDimensions();
const snapshotDimensions = allDimensions.filter((dimension) => ['Completeness', 'Validity', 'Uniqueness', 'Timeliness'].includes(dimension.name));

function result(rule: QualityRule, score: number, rows: number): RuleResult {
  const passingRecords = Math.round(rows * score / 100);
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    dimension: rule.dimension,
    columnName: rule.columnName,
    ruleType: rule.ruleType,
    expectedValue: rule.expectedValue,
    secondaryValue: rule.secondaryValue,
    score,
    passingRecords,
    failingRecords: rows - passingRecords,
    weight: rule.weight ?? 1,
    threshold: rule.threshold ?? 95,
    severity: rule.severity ?? 'Medium',
  };
}

function run(id: string, daysAgo: number, rows: number, seedQuality: number, missing: number, duplicateRows: number): ProfileRun {
  const scores = [Math.min(99.6, seedQuality + 4.8), Math.min(100, seedQuality + 1.2), Math.max(0, seedQuality - 2.1), 100];
  const overallScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const ruleResults = rules.map((rule, index) => result(rule, scores[index], rows));
  const strictScore = Math.max(0, overallScore - 4.5);
  const passingRecords = Math.round(rows * strictScore / 100);
  return {
    id,
    datasetId: dataset.id,
    fileName: `customer_master_${new Date(now.getTime() - daysAgo * 86400000).toISOString().slice(0, 10)}.csv`,
    createdAt: isoDaysAgo(daysAgo),
    rowCount: rows,
    columnCount: columns.length,
    duplicateRows,
    missingCells: missing,
    missingPercentage: (missing / (rows * columns.length)) * 100,
    schemaFingerprint: columns.map((column) => `${column.name}:${column.inferredType}`).join('|'),
    columns,
    sourceKind: 'Demo',
    quality: {
      evaluatedRecords: rows,
      passingRecords,
      failingRecords: rows - passingRecords,
      overallScore,
      recordComplianceScore: strictScore,
      rulesEvaluated: rules.length,
      dimensions: scores.map((score, index) => ({
        dimension: rules[index].dimension,
        score,
        passingRecords: ruleResults[index].passingRecords,
        failingRecords: ruleResults[index].failingRecords,
        activeRules: 1,
        weight: 1,
      })),
      ruleResults,
      scoringMethod: 'weighted-rule-average',
      evaluationStatus: 'governed',
      engineVersion: 'demo-dq-2.0',
      configurationFingerprint: 'demo-config-v1',
      evaluationSnapshot: { version: 1, engineVersion: 'demo-dq-2.0', configurationFingerprint: 'demo-config-v1', evaluatedAt: isoDaysAgo(daysAgo), rules: rules.map((rule) => ({ ...rule })), dimensions: snapshotDimensions.map((dimension) => ({ ...dimension })) },
    },
  };
}

const runs = [
  run('demo-run-1', 29, 11620, 91.4, 520, 14),
  run('demo-run-2', 15, 11880, 93.2, 604, 11),
  run('demo-run-3', 1, 12040, 92.6, 669, 8),
];

const issues: Issue[] = [
  {
    id: 'demo-issue-1', datasetId: dataset.id, runId: 'demo-run-3', category: 'Data quality', severity: 'High', status: 'Open',
    title: 'Email is populated fell below 95%', description: 'The latest governed completeness rule was below its required pass-rate threshold.', createdAt: isoDaysAgo(1), metric: 'Email is populated', currentValue: `${runs[2].quality.ruleResults?.[0].score.toFixed(1)}%`, previousValue: 'Threshold 95.0%',
  },
  {
    id: 'demo-issue-2', datasetId: dataset.id, runId: 'demo-run-3', category: 'Anomaly', severity: 'Medium', status: 'Acknowledged',
    title: 'Income distribution shifted', description: 'The upper quartile and standard deviation moved outside the recent range.', createdAt: isoDaysAgo(1), metric: 'annual_income', currentValue: '62 outliers', previousValue: '31 outliers',
  },
  {
    id: 'demo-issue-3', datasetId: dataset.id, runId: 'demo-run-2', category: 'Record volume', severity: 'Low', status: 'Resolved',
    title: 'Record volume increased 2.2%', description: 'The increase was reviewed and confirmed as expected growth.', createdAt: isoDaysAgo(15), currentValue: '11,880', previousValue: '11,620',
  },
];

export const demoWorkspace: WorkspaceSnapshot = { datasets: [dataset], runs, issues, rules, dimensions: allDimensions, monitors: [], connections: [] };