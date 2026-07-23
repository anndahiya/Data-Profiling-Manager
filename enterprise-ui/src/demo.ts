import type { Dataset, Issue, ProfileRun, WorkspaceSnapshot } from './types';

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
  { name: 'customer_id', inferredType: 'integer', missingCount: 0, missingPercentage: 0, distinctCount: 12040, uniqueCount: 12040, duplicateValueCount: 0, uniquenessPercentage: 100, outlierCount: 0, likelyKey: true, topValues: [], patterns: [], nonNullCount: 12040 },
  { name: 'email', inferredType: 'text', missingCount: 151, missingPercentage: 1.25, distinctCount: 11782, uniqueCount: 11620, duplicateValueCount: 269, uniquenessPercentage: 97.75, outlierCount: 0, likelyKey: false, dominantPattern: 'aaa@aaa.aaa', dominantPatternPercentage: 92.4, topValues: [], patterns: [], nonNullCount: 11889 },
  { name: 'state', inferredType: 'text', missingCount: 480, missingPercentage: 3.99, distinctCount: 51, uniqueCount: 0, duplicateValueCount: 11560, uniquenessPercentage: 0, outlierCount: 0, likelyKey: false, dominantPattern: 'AA', dominantPatternPercentage: 98.6, topValues: [{ value: 'NC', count: 1780, percentage: 15.4 }, { value: 'VA', count: 1420, percentage: 12.3 }], patterns: [{ pattern: 'AA', count: 11400, percentage: 98.6 }], nonNullCount: 11560 },
  { name: 'annual_income', inferredType: 'decimal', missingCount: 38, missingPercentage: 0.32, distinctCount: 11002, uniqueCount: 10110, duplicateValueCount: 1892, uniquenessPercentage: 84.2, outlierCount: 62, likelyKey: false, topValues: [], patterns: [], nonNullCount: 12002, numericStats: { min: 8500, max: 790000, mean: 87920, median: 74200, standardDeviation: 43820, q1: 51200, q3: 104500 } },
  { name: 'updated_at', inferredType: 'date', missingCount: 0, missingPercentage: 0, distinctCount: 26, uniqueCount: 0, duplicateValueCount: 12040, uniquenessPercentage: 0, outlierCount: 0, likelyKey: false, topValues: [], patterns: [], nonNullCount: 12040 },
] as ProfileRun['columns'];

function run(id: string, daysAgo: number, rows: number, quality: number, missing: number, duplicateRows: number): ProfileRun {
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
      passingRecords: Math.round(rows * quality / 100),
      failingRecords: rows - Math.round(rows * quality / 100),
      overallScore: quality,
      rulesEvaluated: 9,
      dimensions: [
        { dimension: 'Completeness', score: Math.min(99.6, quality + 4.8), passingRecords: Math.round(rows * Math.min(99.6, quality + 4.8) / 100), failingRecords: rows - Math.round(rows * Math.min(99.6, quality + 4.8) / 100), activeRules: 5 },
        { dimension: 'Validity', score: quality + 1.2, passingRecords: Math.round(rows * (quality + 1.2) / 100), failingRecords: rows - Math.round(rows * (quality + 1.2) / 100), activeRules: 2 },
        { dimension: 'Uniqueness', score: quality - 2.1, passingRecords: Math.round(rows * (quality - 2.1) / 100), failingRecords: rows - Math.round(rows * (quality - 2.1) / 100), activeRules: 1 },
        { dimension: 'Timeliness', score: 100, passingRecords: rows, failingRecords: 0, activeRules: 1 },
      ],
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
    title: 'Uniqueness dropped below threshold', description: 'Duplicate email values increased in the latest evaluation.', createdAt: isoDaysAgo(1), metric: 'Uniqueness', currentValue: '90.5%', previousValue: '92.1%',
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

export const demoWorkspace: WorkspaceSnapshot = { datasets: [dataset], runs, issues, rules: [] };
