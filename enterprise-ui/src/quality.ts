import type {
  ColumnProfile, DataType, DimensionResult, Issue, QualityDimension, QualityRule, QualitySummary,
  RuleResult, RuleSeverity, SkippedQualityRule,
} from './types';
import type { DataRow } from './profiler';

const BASE_DATE = '2026-01-01T00:00:00.000Z';
const QUALITY_ENGINE_VERSION = 'web-dq-2.0';
const NULL_LIKE = new Set(['', 'null', 'n/a', 'nan', '(blank)']);

export const DIMENSION_LIBRARY: QualityDimension[] = [
  { id: 'accuracy', name: 'Accuracy', description: 'Values correctly represent the real-world entity, event, or fact they describe.', weight: 1, enabled: true, source: 'Standard', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'completeness', name: 'Completeness', description: 'Required records and values are present for the intended use.', weight: 1, enabled: true, source: 'Standard', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'consistency', name: 'Consistency', description: 'Values do not contradict related values, formats, or representations.', weight: 1, enabled: true, source: 'Standard', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'timeliness', name: 'Timeliness', description: 'Data arrives and is available within the timeframe required by its users.', weight: 1, enabled: true, source: 'Standard', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'uniqueness', name: 'Uniqueness', description: 'Entities and governed identifiers are not duplicated.', weight: 1, enabled: true, source: 'Standard', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'validity', name: 'Validity', description: 'Values conform to expected types, formats, ranges, and permitted domains.', weight: 1, enabled: true, source: 'Standard', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'currency', name: 'Currency', description: 'Values reflect the latest known state of the entity they represent.', weight: 1, enabled: false, source: 'Library', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'referential-integrity', name: 'Referential integrity', description: 'Relationships between identifiers and referenced records remain valid.', weight: 1, enabled: false, source: 'Library', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'conformity', name: 'Conformity', description: 'Data follows agreed enterprise standards, code sets, and representations.', weight: 1, enabled: false, source: 'Library', createdAt: BASE_DATE, updatedAt: BASE_DATE },
  { id: 'coverage', name: 'Coverage', description: 'The dataset includes the population, period, or scope required for its purpose.', weight: 1, enabled: false, source: 'Library', createdAt: BASE_DATE, updatedAt: BASE_DATE },
];

export function createDefaultDimensions(): QualityDimension[] {
  return DIMENSION_LIBRARY.map((dimension) => ({ ...dimension }));
}

function isNullLike(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number' && Number.isNaN(value)) return true;
  return typeof value === 'string' && NULL_LIKE.has(value.trim().toLowerCase());
}

function isDateShaped(text: string): boolean {
  return /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:[ T].*)?$/.test(text)
    || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(text)
    ? !Number.isNaN(Date.parse(text)) : false;
}

function inferValueType(value: unknown): DataType {
  if (isNullLike(value)) return 'empty';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return 'date';
  const text = String(value).trim();
  if (/^(true|false|yes|no)$/i.test(text)) return 'boolean';
  if (/^-?\d+$/.test(text)) return 'integer';
  if (/^-?(?:\d+\.\d+|\d+e[+-]?\d+)$/i.test(text)) return 'decimal';
  if (isDateShaped(text)) return 'date';
  return 'text';
}

function patternFor(value: unknown): string {
  if (isNullLike(value)) return '(null)';
  return String(value).trim().replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/\d/g, '9').replace(/\s+/g, ' ');
}

function valueKey(value: unknown): string {
  if (isNullLike(value)) return '(null)';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function numberValue(value?: string): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function evaluateRule(rows: DataRow[], rule: QualityRule): boolean[] {
  const values = rows.map((row) => row[rule.columnName]);
  if (rule.ruleType === 'unique') {
    const counts = new Map<string, number>();
    values.forEach((value) => {
      const key = valueKey(value);
      if (key !== '(null)') counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return values.map((value) => {
      const key = valueKey(value);
      return key !== '(null)' && (counts.get(key) ?? 0) === 1;
    });
  }
  return values.map((value) => {
    if (rule.ruleType === 'not-null') return !isNullLike(value);
    if (isNullLike(value)) return true;
    const text = String(value).trim();
    if (rule.ruleType === 'type') {
      const observed = inferValueType(value);
      return observed === rule.expectedValue || (rule.expectedValue === 'decimal' && observed === 'integer');
    }
    if (rule.ruleType === 'pattern') {
      try { return new RegExp(rule.expectedValue ?? '').test(text) || patternFor(value) === rule.expectedValue; }
      catch { return patternFor(value) === rule.expectedValue; }
    }
    if (rule.ruleType === 'freshness') {
      const days = Math.max(0, numberValue(rule.expectedValue) ?? 30);
      const timestamp = value instanceof Date ? value.getTime() : Date.parse(text);
      return !Number.isNaN(timestamp) && timestamp >= Date.now() - days * 86_400_000;
    }
    if (rule.ruleType === 'range') {
      const numeric = Number(value);
      const minimum = numberValue(rule.expectedValue);
      const maximum = numberValue(rule.secondaryValue);
      return Number.isFinite(numeric) && (minimum === undefined || numeric >= minimum) && (maximum === undefined || numeric <= maximum);
    }
    if (rule.ruleType === 'allowed-values') {
      const allowed = new Set((rule.expectedValue ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
      return allowed.has(text.toLowerCase());
    }
    if (rule.ruleType === 'min-length') return text.length >= (numberValue(rule.expectedValue) ?? 0);
    if (rule.ruleType === 'max-length') return text.length <= (numberValue(rule.expectedValue) ?? Number.MAX_SAFE_INTEGER);
    return true;
  });
}

function activeDimensionMap(dimensions?: QualityDimension[]): Map<string, QualityDimension> {
  const catalog = dimensions?.length ? dimensions : createDefaultDimensions();
  return new Map(catalog.filter((dimension) => dimension.enabled).map((dimension) => [dimension.name.toLowerCase(), dimension]));
}

function configurationFingerprint(rules: QualityRule[], dimensions: QualityDimension[]): string {
  const value = JSON.stringify({
    rules: [...rules].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, datasetId, name, dimension, columnName, ruleType, expectedValue, secondaryValue, enabled, weight, threshold, severity }) => ({ id, datasetId, name, dimension, columnName, ruleType, expectedValue, secondaryValue, enabled, weight, threshold, severity })),
    dimensions: [...dimensions].sort((a, b) => a.id.localeCompare(b.id)).map(({ id, name, description, weight, enabled, source }) => ({ id, name, description, weight, enabled, source })),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildSuggestedRules(datasetId: string, columns: ColumnProfile[]): QualityRule[] {
  const createdAt = new Date().toISOString();
  const rules: QualityRule[] = [];
  const add = (rule: Omit<QualityRule, 'id' | 'datasetId' | 'source' | 'createdAt'>) => rules.push({ ...rule, id: crypto.randomUUID(), datasetId, source: 'Suggested', createdAt });
  columns.forEach((column) => {
    if (column.nonNullCount > 0 && column.missingPercentage <= 2) add({ name: `${column.name} is populated`, dimension: 'Completeness', columnName: column.name, ruleType: 'not-null', enabled: true, weight: 1, threshold: 95, severity: 'Medium' });
    if (column.inferredType !== 'empty') add({ name: `${column.name} has ${column.inferredType} values`, dimension: 'Validity', columnName: column.name, ruleType: 'type', expectedValue: column.inferredType, enabled: true, weight: 1, threshold: 95, severity: 'Medium' });
    if (column.likelyKey) add({ name: `${column.name} is unique`, dimension: 'Uniqueness', columnName: column.name, ruleType: 'unique', enabled: true, weight: 1, threshold: 100, severity: 'High' });
    if (column.inferredType === 'text' && column.dominantPattern && (column.dominantPatternPercentage ?? 0) >= 90) add({ name: `${column.name} follows its dominant pattern`, dimension: 'Consistency', columnName: column.name, ruleType: 'pattern', expectedValue: column.dominantPattern, enabled: true, weight: 1, threshold: 90, severity: 'Low' });
  });
  const dateCandidate = columns.find((column) => column.inferredType === 'date' && /(updated|modified|event|transaction|created|date|timestamp)/i.test(column.name));
  if (dateCandidate) add({ name: `${dateCandidate.name} is no more than 30 days old`, dimension: 'Timeliness', columnName: dateCandidate.name, ruleType: 'freshness', expectedValue: '30', enabled: true, weight: 1, threshold: 95, severity: 'Medium' });
  return rules;
}

export function evaluateConfiguredQuality(rows: DataRow[], columns: ColumnProfile[], configuredRules: QualityRule[], dimensions?: QualityDimension[]): QualitySummary {
  const dimensionMap = activeDimensionMap(dimensions);
  const availableColumns = new Set(columns.map((column) => column.name));
  const skippedRules: SkippedQualityRule[] = [];
  const rules = configuredRules.filter((rule) => {
    if (!rule.enabled) return false;
    if (!availableColumns.has(rule.columnName)) {
      skippedRules.push({ ruleId: rule.id, ruleName: rule.name, reason: `Column “${rule.columnName}” was not present in this run.` });
      return false;
    }
    if (!dimensionMap.has(rule.dimension.toLowerCase())) {
      skippedRules.push({ ruleId: rule.id, ruleName: rule.name, reason: `Dimension “${rule.dimension}” was disabled or unavailable.` });
      return false;
    }
    return true;
  });
  const contributingDimensions = [...new Set(rules.map((rule) => rule.dimension.toLowerCase()))]
    .map((name) => dimensionMap.get(name)).filter((item): item is QualityDimension => Boolean(item)).map((item) => ({ ...item }));
  const evaluatedAt = new Date().toISOString();
  const fingerprint = configurationFingerprint(rules, contributingDimensions);
  const snapshot = { version: 1 as const, engineVersion: QUALITY_ENGINE_VERSION, configurationFingerprint: fingerprint, evaluatedAt, rules: rules.map((rule) => ({ ...rule })), dimensions: contributingDimensions };
  if (!rules.length) return {
    evaluatedRecords: rows.length, passingRecords: 0, failingRecords: 0, overallScore: 0, recordComplianceScore: 0,
    dimensions: [], rulesEvaluated: 0, ruleResults: [], scoringMethod: 'weighted-rule-average', evaluationStatus: 'not-evaluated',
    engineVersion: QUALITY_ENGINE_VERSION, configurationFingerprint: fingerprint, evaluationSnapshot: snapshot, skippedRules,
  };

  const evaluations = rules.map((rule) => {
    const passes = evaluateRule(rows, rule);
    const passingRecords = passes.filter(Boolean).length;
    const result: RuleResult = {
      ruleId: rule.id, ruleName: rule.name, dimension: rule.dimension, columnName: rule.columnName, ruleType: rule.ruleType,
      expectedValue: rule.expectedValue, secondaryValue: rule.secondaryValue, passingRecords, failingRecords: rows.length - passingRecords,
      score: rows.length ? passingRecords / rows.length * 100 : 100, weight: Math.max(0, rule.weight ?? 1),
      threshold: Math.min(100, Math.max(0, rule.threshold ?? 95)), severity: rule.severity ?? 'Medium',
    };
    return { rule, passes, result };
  });
  const grouped = new Map<string, typeof evaluations>();
  evaluations.forEach((item) => grouped.set(item.rule.dimension, [...(grouped.get(item.rule.dimension) ?? []), item]));
  const dimensionResults: DimensionResult[] = [...grouped.entries()].map(([dimension, items]) => {
    const ruleWeight = items.reduce((sum, item) => sum + item.result.weight, 0);
    const passingRecords = rows.filter((_, index) => items.every((item) => item.passes[index])).length;
    const passingChecks = items.reduce((sum, item) => sum + item.result.passingRecords, 0);
    const evaluatedChecks = rows.length * items.length;
    return {
      dimension, passingRecords, failingRecords: rows.length - passingRecords,
      score: ruleWeight ? items.reduce((sum, item) => sum + item.result.score * item.result.weight, 0) / ruleWeight : 100,
      activeRules: items.length, weight: Math.max(0, dimensionMap.get(dimension.toLowerCase())?.weight ?? 1),
      threshold: items.reduce((minimum, item) => Math.min(minimum, item.result.threshold), 100),
      passingChecks, failingChecks: evaluatedChecks - passingChecks, evaluatedChecks,
    };
  });
  const dimensionWeight = dimensionResults.reduce((sum, dimension) => sum + (dimension.weight ?? 1), 0);
  const overallScore = dimensionWeight ? dimensionResults.reduce((sum, dimension) => sum + dimension.score * (dimension.weight ?? 1), 0) / dimensionWeight : 0;
  const passingRecords = rows.filter((_, index) => evaluations.every((item) => item.passes[index])).length;
  return {
    evaluatedRecords: rows.length, passingRecords, failingRecords: rows.length - passingRecords, overallScore,
    recordComplianceScore: rows.length ? passingRecords / rows.length * 100 : 100, dimensions: dimensionResults,
    rulesEvaluated: evaluations.length, ruleResults: evaluations.map((item) => item.result), scoringMethod: 'weighted-rule-average',
    evaluationStatus: 'governed', engineVersion: QUALITY_ENGINE_VERSION, configurationFingerprint: fingerprint,
    evaluationSnapshot: snapshot, skippedRules,
  };
}

export function createQualityIssues(datasetId: string, runId: string, createdAt: string, quality: QualitySummary): Issue[] {
  if (quality.evaluationStatus === 'not-evaluated' || quality.rulesEvaluated === 0) return [];
  return (quality.ruleResults ?? []).filter((rule) => rule.score < rule.threshold).map((rule) => ({
    id: crypto.randomUUID(), datasetId, runId, category: 'Data quality', severity: rule.severity as RuleSeverity, status: 'Open',
    title: `${rule.ruleName} fell below ${rule.threshold.toFixed(0)}%`,
    description: `${rule.failingRecords.toLocaleString()} of ${(rule.passingRecords + rule.failingRecords).toLocaleString()} evaluated records failed this ${rule.dimension.toLowerCase()} rule.`,
    createdAt, metric: rule.ruleName, currentValue: `${rule.score.toFixed(1)}%`, previousValue: `Threshold ${rule.threshold.toFixed(1)}%`,
  }));
}