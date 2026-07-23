export type DataType = 'integer' | 'decimal' | 'date' | 'boolean' | 'text' | 'empty';
export type Dimension = string;
export type IssueCategory = 'Data quality' | 'Schema change' | 'Record volume' | 'Anomaly' | 'Freshness';
export type IssueStatus = 'Open' | 'Acknowledged' | 'Resolved' | 'Closed';
export type SourceMode = 'manual-upload' | 'linked-file' | 'linked-folder' | 'database';
export type RuleSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
export type RuleType = 'not-null' | 'unique' | 'type' | 'pattern' | 'freshness' | 'range' | 'allowed-values' | 'min-length' | 'max-length';

export interface DatasetSource {
  mode: SourceMode;
  displayName?: string;
  filePattern?: string;
  selectionStrategy?: 'latest-modified' | 'highest-filename';
  connectorType?: 'DB2' | 'PostgreSQL' | 'Snowflake' | 'Supabase';
}

export interface LinkedSourceHandle {
  datasetId: string;
  kind: 'file' | 'directory';
  handle: any;
  displayName: string;
  updatedAt: string;
}

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

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  dimension: Dimension;
  passingRecords: number;
  failingRecords: number;
  score: number;
  weight: number;
  threshold: number;
  severity: RuleSeverity;
}

export interface DimensionResult {
  dimension: Dimension;
  passingRecords: number;
  failingRecords: number;
  score: number;
  activeRules: number;
  weight?: number;
  threshold?: number;
  passingChecks?: number;
  failingChecks?: number;
  evaluatedChecks?: number;
}

export interface QualitySummary {
  evaluatedRecords: number;
  passingRecords: number;
  failingRecords: number;
  overallScore: number;
  dimensions: DimensionResult[];
  rulesEvaluated: number;
  recordComplianceScore?: number;
  ruleResults?: RuleResult[];
  scoringMethod?: 'weighted-rule-average' | 'record-pass-all';
}

export interface QualityDimension {
  id: string;
  name: string;
  description: string;
  weight: number;
  enabled: boolean;
  source: 'Standard' | 'Library' | 'User';
  createdAt: string;
  updatedAt: string;
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
  source?: DatasetSource;
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
  sourceKind: 'CSV' | 'Excel' | 'Demo' | 'Linked file' | 'Linked folder' | 'Database';
  sourceReference?: string;
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
  ruleType: RuleType;
  expectedValue?: string;
  secondaryValue?: string;
  enabled: boolean;
  source: 'Suggested' | 'User';
  weight?: number;
  threshold?: number;
  severity?: RuleSeverity;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Issue {
  id: string;
  datasetId: string;
  runId: string;
  category: IssueCategory;
  severity: RuleSeverity;
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
  dimensions?: QualityDimension[];
}