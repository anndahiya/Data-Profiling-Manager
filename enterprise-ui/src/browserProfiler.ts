import { isNullLike, normalizeNullTokens } from './nullPolicy';
import type { ColumnProfile, DataType, NumericStats, PatternValue, ProfileRun, TopValue } from './types';
import type { DataRow } from './profiler';

function normalizeHeaders(headers: unknown[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const raw = String(header ?? '').trim() || `unnamed_${index + 1}`;
    const count = (counts.get(raw) ?? 0) + 1;
    counts.set(raw, count);
    return count === 1 ? raw : `${raw}__${count}`;
  });
}

function isDateShaped(text: string): boolean {
  const numericDate = /^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})(?:[ T].*)?$/;
  const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;
  const namedMonth = /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}(?:\s+.*)?$/i;
  return (numericDate.test(text) || isoTimestamp.test(text) || namedMonth.test(text)) && !Number.isNaN(Date.parse(text));
}

function inferValueType(value: unknown, nullTokens: readonly string[]): DataType {
  if (isNullLike(value, nullTokens)) return 'empty';
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

function inferColumnType(values: unknown[], nullTokens: readonly string[]): DataType {
  const counts: Record<DataType, number> = { integer: 0, decimal: 0, date: 0, boolean: 0, text: 0, empty: 0 };
  values.forEach((value) => counts[inferValueType(value, nullTokens)] += 1);
  const observed = (Object.entries(counts) as Array<[DataType, number]>).filter(([type]) => type !== 'empty');
  if (!observed.length) return 'empty';
  observed.sort((a, b) => b[1] - a[1]);
  const winner = observed[0][0];
  if (winner === 'integer' && counts.decimal > 0) return 'decimal';
  return winner;
}

function valueKey(value: unknown, nullTokens: readonly string[]): string {
  if (isNullLike(value, nullTokens)) return '(null)';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function numericStats(values: number[]): NumericStats | undefined {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return undefined;
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return { min: finite[0], max: finite[finite.length - 1], mean, median: quantile(finite, .5), standardDeviation: Math.sqrt(variance), q1: quantile(finite, .25), q3: quantile(finite, .75) };
}

function patternFor(value: unknown, nullTokens: readonly string[]): string {
  if (isNullLike(value, nullTokens)) return '(null)';
  return String(value).trim().replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/\d/g, '9').replace(/\s+/g, ' ');
}

function topEntries(map: Map<string, number>, total: number, limit: number): TopValue[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([value, count]) => ({ value, count, percentage: total ? count / total * 100 : 0 }));
}

function patternEntries(map: Map<string, number>, total: number, limit = 8): PatternValue[] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([pattern, count]) => ({ pattern, count, percentage: total ? count / total * 100 : 0 }));
}

function profileColumn(name: string, rows: DataRow[], nullTokens: readonly string[]): ColumnProfile {
  const values = rows.map((row) => row[name]);
  const inferredType = inferColumnType(values, nullTokens);
  const nonNull = values.filter((value) => !isNullLike(value, nullTokens));
  const frequencies = new Map<string, number>();
  const patterns = new Map<string, number>();
  nonNull.forEach((value) => {
    const key = valueKey(value, nullTokens);
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
    const pattern = patternFor(value, nullTokens);
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
    name, inferredType, nonNullCount: nonNull.length, missingCount,
    missingPercentage: values.length ? missingCount / values.length * 100 : 0,
    distinctCount: frequencies.size, uniqueCount, duplicateValueCount,
    uniquenessPercentage: nonNull.length ? uniqueCount / nonNull.length * 100 : 0,
    outlierCount,
    likelyKey: identifierHint && nonNull.length > 0 && frequencies.size / nonNull.length >= .98,
    dominantPattern: patternList[0]?.pattern,
    dominantPatternPercentage: patternList[0]?.percentage,
    topValues: topEntries(frequencies, nonNull.length, 5),
    patterns: patternList,
    numericStats: stats,
  };
}

function duplicateRows(rows: DataRow[], headers: string[], nullTokens: readonly string[]): number {
  const seen = new Set<string>();
  let duplicates = 0;
  rows.forEach((row) => {
    const key = JSON.stringify(headers.map((header) => valueKey(row[header], nullTokens)));
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  });
  return duplicates;
}

export function profileBrowserRows(rows: DataRow[], datasetId: string, fileName: string, sourceKind: ProfileRun['sourceKind'], configuredNullTokens?: readonly string[]): ProfileRun {
  if (!rows.length) throw new Error('The file does not contain any data rows.');
  const nullTokens = normalizeNullTokens(configuredNullTokens);
  const headers = normalizeHeaders(Object.keys(rows[0]));
  const normalizedRows = rows.map((row) => {
    const output: DataRow = {};
    headers.forEach((header) => { output[header] = row[header]; });
    return output;
  });
  const columns = headers.map((header) => profileColumn(header, normalizedRows, nullTokens));
  const missingCells = columns.reduce((sum, column) => sum + column.missingCount, 0);
  return {
    id: crypto.randomUUID(), datasetId, fileName, createdAt: new Date().toISOString(),
    rowCount: normalizedRows.length, columnCount: columns.length,
    duplicateRows: duplicateRows(normalizedRows, headers, nullTokens), missingCells,
    missingPercentage: normalizedRows.length && columns.length ? missingCells / (normalizedRows.length * columns.length) * 100 : 0,
    schemaFingerprint: columns.map((column) => `${column.name}:${column.inferredType}`).sort().join('|'),
    columns,
    quality: { evaluatedRecords: normalizedRows.length, passingRecords: 0, failingRecords: 0, overallScore: 0, dimensions: [], rulesEvaluated: 0, evaluationStatus: 'not-evaluated' },
    sourceKind,
    nullTokens,
  };
}
