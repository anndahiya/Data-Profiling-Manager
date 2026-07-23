export type DataType = 'integer' | 'decimal' | 'date' | 'boolean' | 'text' | 'empty';
export type Dimension = 'Completeness' | 'Validity' | 'Uniqueness' | 'Consistency' | 'Timeliness';
export type IssueCategory = 'Data quality' | 'Schema change' | 'Record volume' | 'Anomaly' | 'Freshness';
export type IssueStatus = 'Open' | 'Acknowledged' | 'Resolved' | 'Closed';

export interface TopValue {
  value: string;
  count: number;
  percentage: number;
}

export interface PatternValue {
  pattern: string;
  count: number;
  percentage: number;
}

export interface NumericStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  standardDeviation: number;
  q1: number;
  q3: number;
}

export interface ColumnProfile {
  name: string;
  inferredType: DataType;
  nonNullCount: number;
  missingCount: number;
  missingPercentage: number;
  distinctCount: number;
  uniqueCount: number;
  duplicateValueCount: number;
  uniquenessPercentage: number;
  outlierCount: number;
  likelyKey: boolean;
  dominantPattern?: string;
  dominantPatternPercentage?: number;
  topValues: TopValue[];
  patterns: PatternValue[];
  numericStats?: NumericStats;
}

export interface DimensionResult {
  dimension: Dimension;
  passingRecords: number;
  failingRecords: number;
  score: number;
  activeRules: number;
}

export interface QualitySummary {
  evaluatedRecords: number;
  passingRecords: number;
  failingRecords: number;
  overallScore: number;
  dimensions: DimensionResult[];
  rulesEvaluated: number;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  owner: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  latestRunId?: string;
}

export interface ProfileRun {
  id: string;
  datasetId: string;
  fileName: string;
  createdAt: string;
  rowCount: number;
  columnCount: number;
  duplicateRows: number;
  missingCells: number;
  missingPercentage: number;
  schemaFingerprint: string;
  columns: ColumnProfile[];
  quality: QualitySummary;
  sourceKind: 'CSV' | 'Excel' | 'Demo';
}

export interface SchemaDiff {
  added: string[];
  removed: string[];
  changed: Array<{ name: string; before: DataType; after: DataType }>;
  hasChanges: boolean;
}

export interface QualityRule {
  id: string;
  datasetId: string;
  name: string;
  dimension: Dimension;
  columnName: string;
  ruleType: 'not-null' | 'unique' | 'type' | 'pattern' | 'freshness';
  expectedValue?: string;
  enabled: boolean;
  source: 'Suggested' | 'User';
  createdAt: string;
}

export interface Issue {
  id: string;
  datasetId: string;
  runId: string;
  category: IssueCategory;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  status: IssueStatus;
  title: string;
  description: string;
  createdAt: string;
  metric?: string;
  currentValue?: string;
  previousValue?: string;
}

export interface WorkspaceSnapshot {
  datasets: Dataset[];
  runs: ProfileRun[];
  issues: Issue[];
  rules: QualityRule[];
}
