import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import type {
  ColumnProfile,
  DataType,
  Dataset,
  Dimension,
  DimensionResult,
  Issue,
  NumericStats,
  PatternValue,
  ProfileRun,
  QualitySummary,
  SchemaDiff,
  TopValue,
} from './types';

export type DataRow = Record<string, unknown>;

const NULL_LIKE = new Set(['', 'null', 'none', 'n/a', 'na', 'nan', 'unknown', '(blank)']);

function isNullLike(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number' && Number.isNaN(value)) return true;
  if (typeof value === 'string') return NULL_LIKE.has(value.trim().toLowerCase());
  return false;
}

function normalizeHeaders(headers: unknown[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const raw = String(header ?? '').trim() || `unnamed_${index + 1}`;
    const count = (counts.get(raw) ?? 0) + 1;
    counts.set(raw, count);
    return count === 1 ? raw : `${raw}__${count}`;
  });
}

export async function parseFile(file: File): Promise<{ rows: DataRow[]; sourceKind: 'CSV' | 'Excel' }> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv' || extension === 'txt') {
    const text = await file.text();
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, unknown>>(text, {
        header: true,
        skipEmptyLines: 'greedy',
        dynamicTyping: true,
        transformHeader: (header, index) => header.trim() || `unnamed_${index + 1}`,
        complete: ({ data, errors, meta }) => {
          const fatal = errors.find((error) => error.type === 'Delimiter' || error.type === 'Quotes');
          if (fatal) {
            reject(new Error(`CSV parsing failed: ${fatal.message}`));
            return;
          }
          const fields = normalizeHeaders(meta.fields ?? []);
          const sourceFields = meta.fields ?? [];
          const normalized = data.map((row) => {
            const output: DataRow = {};
            fields.forEach((field, index) => {
              output[field] = row[sourceFields[index] ?? field];
            });
            return output;
          });
          resolve({ rows: normalized, sourceKind: 'CSV' });
        },
        error: (error: Error) => reject(error),
      });
    });
  }
  if (extension === 'xlsx') {
    const sheet = await readSheet(file);
    if (!sheet.length) throw new Error('The workbook does not contain any rows.');
    const headers = normalizeHeaders(sheet[0]);
    const rows = sheet.slice(1).map((values) => {
      const row: DataRow = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? null;
      });
      return row;
    });
    return { rows, sourceKind: 'Excel' };
  }
  throw new Error('This web edition currently supports CSV and .xlsx files. Use the local Python edition for .xls and Parquet.');
}

function isDateShaped(text: string): boolean {
  const numericDate = /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:[ T].*)?$/;
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;
  const namedMonth = /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}(?:\s+.*)?$/i;
  return (numericDate.test(text) || isoTimestamp.test(text) || namedMonth.test(text)) && !Number.isNaN(Date.parse(text));
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

function inferColumnType(values: unknown[]): DataType {
  const counts: Record<DataType, number> = { integer: 0, decimal: 0, date: 0, boolean: 0, text: 0, empty: 0 };
  values.forEach((value) => counts[inferValueType(value)] += 1);
  const observed = (Object.entries(counts) as Array<[DataType, number]>).filter(([type]) => type !== 'empty');
  if (!observed.length) return 'empty';
  observed.sort((a, b) => b[1] - a[1]);
  const winner = observed[0][0];
  if (winner === 'integer' && counts.decimal > 0) return 'decimal';
  return winner;
}

function valueKey(value: unknown): string {
  if (isNullLike(value)) return '(null)';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base];
}

function numericStats(values: number[]): NumericStats | undefined {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return undefined;
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return {
    min: finite[0],
    max: finite[finite.length - 1],
    mean,
    median: quantile(finite, 0.5),
    standardDeviation: Math.sqrt(variance),
    q1: quantile(finite, 0.25),
    q3: quantile(finite, 0.75),
  };
}

function patternFor(value: unknown): string {
  if (isNullLike(value)) return '(null)';
  return String(value)
    .trim()
    .replace(/[A-Z]/g, 'A')
    .replace(/[a-z]/g, 'a')
    .replace(/\d/g, '9')
    .replace(/\s+/g, ' ');
}

function topEntries(map: Map<string, number>, total: number, limit: number): TopValue[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count, percentage: total ? (count / total) * 100 : 0 }));
}

function patternEntries(map: Map<string, number>, total: number, limit = 8): PatternValue[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([pattern, count]) => ({ pattern, count, percentage: total ? (count / total) * 100 : 0 }));
}

function profileColumn(name: string, rows: DataRow[]): ColumnProfile {
  const values = rows.map((row) => row[name]);
  const inferredType = inferColumnType(values);
  const nonNull = values.filter((value) => !isNullLike(value));
  const frequencies = new Map<string, number>();
  const patterns = new Map<string, number>();
  nonNull.forEach((value) => {
    const key = valueKey(value);
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    const pattern = patternFor(value);
    patterns.set(pattern, (patterns.get(pattern) ?? 0) + 1);
  });
  const uniqueCount = [...frequencies.values()].filter((count) => count === 1).length;
  const duplicateValueCount = nonNull.length - uniqueCount;
  const missingCount = values.length - nonNull.length;
  const numericValues = nonNull.map(Number).filter(Number.isFinite);
  const stats = inferredType === 'integer' || inferredType === 'decimal' ? numericStats(numericValues) : undefined;
  let outlierCount = 0;
  if (stats) {
    const iqr = stats.q3 - stats.q1;
    const lower = stats.q1 - 1.5 * iqr;
    const upper = stats.q3 + 1.5 * iqr;
    outlierCount = numericValues.filter((value) => value < lower || value > upper).length;
  }
  const patternList = patternEntries(patterns, nonNull.length);
  const identifierHint = /(^|_)(id|key|code|number|no)($|_)/i.test(name);
  return {
    name,
    inferredType,
    nonNullCount: nonNull.length,
    missingCount,
    missingPercentage: values.length ? (missingCount / values.length) * 100 : 0,
    distinctCount: frequencies.size,
    uniqueCount,
    duplicateValueCount,
    uniquenessPercentage: nonNull.length ? (uniqueCount / nonNull.length) * 100 : 0,
    outlierCount,
    likelyKey: identifierHint && nonNull.length > 0 && frequencies.size / nonNull.length >= 0.98,
    dominantPattern: patternList[0]?.pattern,
    dominantPatternPercentage: patternList[0]?.percentage,
    topValues: topEntries(frequencies, nonNull.length, 5),
    patterns: patternList,
    numericStats: stats,
  };
}

function evaluateQuality(rows: DataRow[], columns: ColumnProfile[]): QualitySummary {
  const dimensionPasses: Record<Dimension, boolean[]> = {
    Completeness: rows.map(() => true),
    Validity: rows.map(() => true),
    Uniqueness: rows.map(() => true),
    Consistency: rows.map(() => true),
    Timeliness: rows.map(() => true),
  };
  const activeRules: Record<Dimension, number> = {
    Completeness: 0,
    Validity: 0,
    Uniqueness: 0,
    Consistency: 0,
    Timeliness: 0,
  };

  columns.forEach((column) => {
    activeRules.Completeness += 1;
    rows.forEach((row, index) => {
      if (isNullLike(row[column.name])) dimensionPasses.Completeness[index] = false;
    });

    if (column.inferredType !== 'empty') {
      activeRules.Validity += 1;
      rows.forEach((row, index) => {
        const value = row[column.name];
        if (!isNullLike(value) && inferValueType(value) !== column.inferredType) {
          if (!(column.inferredType === 'decimal' && inferValueType(value) === 'integer')) {
            dimensionPasses.Validity[index] = false;
          }
        }
      });
    }

    if (column.likelyKey) {
      activeRules.Uniqueness += 1;
      const counts = new Map<string, number>();
      rows.forEach((row) => {
        const key = valueKey(row[column.name]);
        if (key !== '(null)') counts.set(key, (counts.get(key) ?? 0) + 1);
      });
      rows.forEach((row, index) => {
        const key = valueKey(row[column.name]);
        if (key === '(null)' || (counts.get(key) ?? 0) > 1) dimensionPasses.Uniqueness[index] = false;
      });
    }

    if (column.inferredType === 'text' && (column.dominantPatternPercentage ?? 0) >= 90 && column.dominantPattern) {
      activeRules.Consistency += 1;
      rows.forEach((row, index) => {
        const value = row[column.name];
        if (!isNullLike(value) && patternFor(value) !== column.dominantPattern) dimensionPasses.Consistency[index] = false;
      });
    }
  });

  const dateCandidate = columns.find((column) =>
    column.inferredType === 'date' && /(updated|modified|event|transaction|created|date|timestamp)/i.test(column.name),
  );
  if (dateCandidate) {
    activeRules.Timeliness = 1;
    const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    rows.forEach((row, index) => {
      const value = row[dateCandidate.name];
      if (!isNullLike(value)) {
        const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value));
        if (!Number.isNaN(timestamp) && timestamp < threshold) dimensionPasses.Timeliness[index] = false;
      }
    });
  }

  const dimensions = (Object.keys(dimensionPasses) as Dimension[])
    .filter((dimension) => activeRules[dimension] > 0)
    .map<DimensionResult>((dimension) => {
      const passingRecords = dimensionPasses[dimension].filter(Boolean).length;
      const failingRecords = rows.length - passingRecords;
      return {
        dimension,
        passingRecords,
        failingRecords,
        score: rows.length ? (passingRecords / rows.length) * 100 : 100,
        activeRules: activeRules[dimension],
      };
    });

  const contributing = (Object.keys(dimensionPasses) as Dimension[]).filter((dimension) => activeRules[dimension] > 0);
  const allPass = rows.map((_, index) => contributing.every((dimension) => dimensionPasses[dimension][index]));
  const passingRecords = allPass.filter(Boolean).length;
  return {
    evaluatedRecords: rows.length,
    passingRecords,
    failingRecords: rows.length - passingRecords,
    overallScore: rows.length ? (passingRecords / rows.length) * 100 : 100,
    dimensions,
    rulesEvaluated: contributing.reduce((sum, dimension) => sum + activeRules[dimension], 0),
  };
}

function duplicateRows(rows: DataRow[], headers: string[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  rows.forEach((row) => {
    const key = JSON.stringify(headers.map((header) => valueKey(row[header])));
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  });
  return duplicates;
}

export function schemaFingerprint(columns: ColumnProfile[]): string {
  return columns.map((column) => `${column.name}:${column.inferredType}`).sort().join('|');
}

export function compareSchema(previous: ProfileRun | undefined, nextColumns: ColumnProfile[]): SchemaDiff {
  if (!previous) return { added: [], removed: [], changed: [], hasChanges: false };
  const before = new Map(previous.columns.map((column) => [column.name, column.inferredType]));
  const after = new Map(nextColumns.map((column) => [column.name, column.inferredType]));
  const added = [...after.keys()].filter((name) => !before.has(name)).sort();
  const removed = [...before.keys()].filter((name) => !after.has(name)).sort();
  const changed = [...before.keys()]
    .filter((name) => after.has(name) && before.get(name) !== after.get(name))
    .map((name) => ({ name, before: before.get(name)!, after: after.get(name)! }));
  return { added, removed, changed, hasChanges: Boolean(added.length || removed.length || changed.length) };
}

export function profileRows(
  rows: DataRow[],
  datasetId: string,
  fileName: string,
  sourceKind: ProfileRun['sourceKind'],
): ProfileRun {
  if (!rows.length) throw new Error('The file does not contain any data rows.');
  const headers = normalizeHeaders(Object.keys(rows[0]));
  const normalizedRows = rows.map((row) => {
    const output: DataRow = {};
    headers.forEach((header) => {
      output[header] = row[header];
    });
    return output;
  });
  const columns = headers.map((header) => profileColumn(header, normalizedRows));
  const missingCells = columns.reduce((sum, column) => sum + column.missingCount, 0);
  return {
    id: crypto.randomUUID(),
    datasetId,
    fileName,
    createdAt: new Date().toISOString(),
    rowCount: normalizedRows.length,
    columnCount: columns.length,
    duplicateRows: duplicateRows(normalizedRows, headers),
    missingCells,
    missingPercentage: normalizedRows.length && columns.length ? (missingCells / (normalizedRows.length * columns.length)) * 100 : 0,
    schemaFingerprint: schemaFingerprint(columns),
    columns,
    quality: evaluateQuality(normalizedRows, columns),
    sourceKind,
  };
}

export function createIssues(dataset: Dataset, run: ProfileRun, previous?: ProfileRun): Issue[] {
  const issues: Issue[] = [];
  const now = run.createdAt;
  const push = (issue: Omit<Issue, 'id' | 'datasetId' | 'runId' | 'createdAt' | 'status'>) => {
    issues.push({ ...issue, id: crypto.randomUUID(), datasetId: dataset.id, runId: run.id, createdAt: now, status: 'Open' });
  };

  run.quality.dimensions.forEach((dimension) => {
    if (dimension.score < 95) {
      push({
        category: 'Data quality',
        severity: dimension.score < 80 ? 'High' : 'Medium',
        title: `${dimension.dimension} fell below 95%`,
        description: `${dimension.failingRecords.toLocaleString()} records failed one or more ${dimension.dimension.toLowerCase()} checks.`,
        metric: dimension.dimension,
        currentValue: `${dimension.score.toFixed(1)}%`,
      });
    }
  });

  const schema = compareSchema(previous, run.columns);
  if (schema.hasChanges) {
    push({
      category: 'Schema change',
      severity: schema.removed.length || schema.changed.length ? 'High' : 'Medium',
      title: 'Schema changed from the previous run',
      description: `${schema.added.length} added, ${schema.removed.length} removed, and ${schema.changed.length} datatype changes detected.`,
      currentValue: `${run.columnCount} columns`,
      previousValue: previous ? `${previous.columnCount} columns` : undefined,
    });
  }

  if (previous && previous.rowCount > 0) {
    const change = ((run.rowCount - previous.rowCount) / previous.rowCount) * 100;
    if (Math.abs(change) >= 20) {
      push({
        category: 'Record volume',
        severity: Math.abs(change) >= 50 ? 'High' : 'Medium',
        title: `Record volume changed ${change > 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}%`,
        description: 'The number of records differs materially from the previous run.',
        currentValue: run.rowCount.toLocaleString(),
        previousValue: previous.rowCount.toLocaleString(),
      });
    }
  }

  const columnsWithOutliers = run.columns.filter((column) => column.outlierCount > 0);
  if (columnsWithOutliers.length) {
    push({
      category: 'Anomaly',
      severity: 'Low',
      title: `Outliers detected in ${columnsWithOutliers.length} column${columnsWithOutliers.length === 1 ? '' : 's'}`,
      description: columnsWithOutliers.slice(0, 4).map((column) => `${column.name} (${column.outlierCount})`).join(', '),
      currentValue: columnsWithOutliers.reduce((sum, column) => sum + column.outlierCount, 0).toLocaleString(),
    });
  }
  return issues;
}
