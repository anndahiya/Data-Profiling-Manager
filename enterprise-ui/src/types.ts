export type DataType = 'integer' | 'decimal' | 'date' | 'boolean' | 'text' | 'empty';
export type Dimension = string;
export type IssueCategory = 'Data quality' | 'Schema change' | 'Record volume' | 'Anomaly' | 'Freshness';
export type IssueStatus = 'Open' | 'Acknowledged' | 'Resolved' | 'Closed';
export type SourceMode = 'manual-upload' | 'linked-file' | 'linked-folder' | 'database';
export type DatabaseProvider = 'DB2' | 'PostgreSQL' | 'Snowflake' | 'Supabase';
export type RuleSeverity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
export type RuleType = 'not-null' | 'unique' | 'type' | 'pattern' | 'freshness' | 'range' | 'allowed-values' | 'min-length' | 'max-length';
export type ScheduleCadence = 'Daily' | 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
export type DeliveryMode = 'every-run' | 'breach-only';
export type ColumnClassification = 'Empty' | 'Constant' | 'Likely key' | 'Measure' | 'Date/time' | 'Boolean' | 'Categorical/other';
export type QualityEvaluationStatus = 'governed' | 'not-evaluated' | 'legacy';

export interface DatasetSource {
  mode: SourceMode;
  displayName?: string;
  filePattern?: string;
  selectionStrategy?: 'latest-modified' | 'highest-filename';
  connectorType?: DatabaseProvider;
  connectionId?: string;
}

export interface DatabaseConnection {
  id: string;
  datasetId: string;
  name: string;
  provider: DatabaseProvider;
  host: string;
  port: number;
  database: string;
  schema?: string;
  account?: string;
  warehouse?: string;
  role?: string;
  sslMode?: 'require' | 'prefer' | 'disable';
  secretPrefix: string;
  query: string;
  maxRows: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedSourceHandle {
  datasetId: string;
  kind: 'file' | 'directory';
  handle: any;
  displayName: string;
  updatedAt: string;
}

export interface TopValue { value: string; count: number; percentage: number; }
export interface PatternValue { pattern: string; count: number; percentage: number; }
export interface NumericStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  standardDeviation: number;
  q1: number;
  q3: number;
  skewness?: number;
  kurtosis?: number;
}
export interface TextStats { minLength: number; maxLength: number; meanLength: number; }
export interface DateStats { min?: string; max?: string; rangeDays?: number; }
export interface CorrelationValue { left: string; right: string; value: number; }
export interface ColumnRename { original: string; profiledAs: string; }

export interface ColumnProfile {
  name: string;
  inferredType: DataType;
  nativeType?: string;
  nonNullCount: number;
  missingCount: number;
  missingPercentage: number;
  distinctCount: number;
  uniqueCount: number;
  duplicateValueCount: number;
  uniquenessPercentage: number;
  cardinalityRatio?: number;
  outlierCount: number;
  likelyKey: boolean;
  classification?: ColumnClassification;
  dominantPattern?: string;
  dominantPatternPercentage?: number;
  topValues: TopValue[];
  patterns: PatternValue[];
  numericStats?: NumericStats;
  textStats?: TextStats;
  dateStats?: DateStats;
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

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  dimension: Dimension;
  columnName?: string;
  ruleType?: RuleType;
  expectedValue?: string;
  secondaryValue?: string;
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

export interface QualityEvaluationSnapshot {
  version: 1;
  engineVersion: string;
  configurationFingerprint: string;
  evaluatedAt: string;
  rules: QualityRule[];
  dimensions: QualityDimension[];
}

export interface SkippedQualityRule {
  ruleId: string;
  ruleName: string;
  reason: string;
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
  evaluationStatus?: QualityEvaluationStatus;
  engineVersion?: string;
  configurationFingerprint?: string;
  evaluationSnapshot?: QualityEvaluationSnapshot;
  skippedRules?: SkippedQualityRule[];
}

export interface MonitorPolicy {
  id: string;
  datasetId: string;
  enabled: boolean;
  sourcePath: string;
  recipientName: string;
  recipientEmail: string;
  ccEmails?: string;
  cadence: ScheduleCadence;
  weekday: string;
  dayOfMonth: number;
  month: number;
  hourUtc: number;
  minute: number;
  deliveryMode: DeliveryMode;
  attachReport: boolean;
  aiSummary: boolean;
  minimumOverallQuality?: number;
  minimumRecordCompliance?: number;
  maximumMissingPercent?: number;
  maximumDuplicateRows?: number;
  maximumRowChangePercent?: number;
  maximumFreshnessHours?: number;
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
  memoryUsageMB?: number;
  numericColumnCount?: number;
  otherColumnCount?: number;
  schemaFingerprint: string;
  columns: ColumnProfile[];
  correlations?: CorrelationValue[];
  columnRenames?: ColumnRename[];
  quality: QualitySummary;
  sourceKind: 'CSV' | 'Excel' | 'Parquet' | 'Demo' | 'Linked file' | 'Linked folder' | 'Database';
  sourceReference?: string;
}

export interface SchemaDiff {
  added: string[];
  removed: string[];
  changed: Array<{ name: string; before: DataType; after: DataType }>;
  hasChanges: boolean;
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
  issueKey?: string;
  firstDetectedAt?: string;
  lastDetectedAt?: string;
  occurrenceCount?: number;
  resolvedAt?: string;
  latestRunId?: string;
}

export interface WorkspaceSettings {
  id: 'workspace';
  autoCleanupEnabled: boolean;
  maxRunsPerAsset: number;
  resolvedIssueRetentionDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSnapshot {
  datasets: Dataset[];
  runs: ProfileRun[];
  issues: Issue[];
  rules: QualityRule[];
  dimensions?: QualityDimension[];
  monitors?: MonitorPolicy[];
  connections?: DatabaseConnection[];
  settings?: WorkspaceSettings;
}
