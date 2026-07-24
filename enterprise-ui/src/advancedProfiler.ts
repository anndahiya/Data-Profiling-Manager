import type { ColumnClassification, ColumnProfile, CorrelationValue, DataType, ProfileRun } from './types';
import type { DataRow } from './profiler';

export const MAX_CORRELATION_COLUMNS = 40;
const NULL_TOKENS = ['', 'null', 'n/a', 'nan', '(blank)'];

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number' && Number.isNaN(value)) return true;
  if (typeof value === 'string') return NULL_TOKENS.includes(value.trim().toLowerCase());
  return false;
}

function finiteNumbers(rows: DataRow[], column: string): number[] {
  return rows.map((row) => row[column]).filter((value) => !isMissing(value)).map(Number).filter(Number.isFinite);
}

function distributionShape(values: number[]): { skewness?: number; kurtosis?: number } {
  const count = values.length;
  if (count < 3) return {};
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const centered = values.map((value) => value - mean);
  const m2 = centered.reduce((sum, value) => sum + value ** 2, 0) / count;
  if (!m2) return { skewness: 0, kurtosis: 0 };
  const m3 = centered.reduce((sum, value) => sum + value ** 3, 0) / count;
  const m4 = centered.reduce((sum, value) => sum + value ** 4, 0) / count;
  return { skewness: m3 / Math.pow(m2, 1.5), kurtosis: m4 / (m2 ** 2) - 3 };
}

function classification(column: ColumnProfile): ColumnClassification {
  if (column.inferredType === 'empty') return 'Empty';
  if (column.distinctCount <= 1) return 'Constant';
  if (column.likelyKey) return 'Likely key';
  if (column.inferredType === 'integer' || column.inferredType === 'decimal') return 'Measure';
  if (column.inferredType === 'date') return 'Date/time';
  if (column.inferredType === 'boolean') return 'Boolean';
  return 'Categorical/other';
}

function textStatistics(rows: DataRow[], column: string) {
  const lengths = rows.map((row) => row[column]).filter((value) => !isMissing(value)).map((value) => String(value).length);
  if (!lengths.length) return undefined;
  return { minLength: Math.min(...lengths), maxLength: Math.max(...lengths), meanLength: lengths.reduce((sum, value) => sum + value, 0) / lengths.length };
}

function dateStatistics(rows: DataRow[], column: string) {
  const timestamps = rows.map((row) => row[column]).filter((value) => !isMissing(value)).map((value) => value instanceof Date ? value.getTime() : Date.parse(String(value))).filter(Number.isFinite).sort((a, b) => a - b);
  if (!timestamps.length) return undefined;
  return { min: new Date(timestamps[0]).toISOString(), max: new Date(timestamps[timestamps.length - 1]).toISOString(), rangeDays: (timestamps[timestamps.length - 1] - timestamps[0]) / 86_400_000 };
}

export function enrichColumnProfiles(rows: DataRow[], columns: ColumnProfile[]): ColumnProfile[] {
  return columns.map((column) => {
    const cardinalityRatio = rows.length ? column.distinctCount / rows.length : 0;
    const numeric = column.inferredType === 'integer' || column.inferredType === 'decimal';
    const shape = numeric ? distributionShape(finiteNumbers(rows, column.name)) : {};
    return {
      ...column,
      topValues: [],
      nativeType: column.inferredType,
      cardinalityRatio,
      classification: classification(column),
      numericStats: column.numericStats ? { ...column.numericStats, ...shape } : undefined,
      textStats: column.inferredType === 'text' ? textStatistics(rows, column.name) : undefined,
      dateStats: column.inferredType === 'date' ? dateStatistics(rows, column.name) : undefined,
    };
  });
}

function pearson(left: Array<number | undefined>, right: Array<number | undefined>): number | undefined {
  const pairs = left.map((value, index) => [value, right[index]] as const).filter((pair): pair is readonly [number, number] => Number.isFinite(pair[0]) && Number.isFinite(pair[1]));
  if (pairs.length < 2) return undefined;
  const leftMean = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const rightMean = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0; let leftSquares = 0; let rightSquares = 0;
  pairs.forEach(([leftValue, rightValue]) => {
    const leftDelta = leftValue - leftMean; const rightDelta = rightValue - rightMean;
    numerator += leftDelta * rightDelta; leftSquares += leftDelta ** 2; rightSquares += rightDelta ** 2;
  });
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator ? numerator / denominator : undefined;
}

export function correlationProfile(rows: DataRow[], columns: ColumnProfile[]): CorrelationValue[] {
  const numericColumns = columns.filter((column) => column.inferredType === 'integer' || column.inferredType === 'decimal').slice(0, MAX_CORRELATION_COLUMNS);
  const values = new Map<string, Array<number | undefined>>();
  numericColumns.forEach((column) => values.set(column.name, rows.map((row) => {
    const value = row[column.name];
    if (isMissing(value)) return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  })));
  const output: CorrelationValue[] = [];
  numericColumns.forEach((left, leftIndex) => {
    numericColumns.slice(leftIndex).forEach((right) => {
      const value = left.name === right.name ? 1 : pearson(values.get(left.name) ?? [], values.get(right.name) ?? []);
      if (value !== undefined) output.push({ left: left.name, right: right.name, value: Number(value.toFixed(4)) });
    });
  });
  return output;
}

function memoryUsageMB(rows: DataRow[]): number {
  try { return new TextEncoder().encode(JSON.stringify(rows)).byteLength / 1_000_000; }
  catch { return 0; }
}

export function enhanceProfileRun(rows: DataRow[], run: ProfileRun): ProfileRun {
  const columns = enrichColumnProfiles(rows, run.columns);
  const numericColumnCount = columns.filter((column) => column.inferredType === 'integer' || column.inferredType === 'decimal').length;
  return { ...run, columns, memoryUsageMB: memoryUsageMB(rows), numericColumnCount, otherColumnCount: Math.max(0, columns.length - numericColumnCount), correlations: correlationProfile(rows, columns) };
}

export function classificationLabel(type: DataType, column?: ColumnProfile): string {
  return column?.classification ?? (type === 'date' ? 'Date/time' : type === 'boolean' ? 'Boolean' : type === 'integer' || type === 'decimal' ? 'Measure' : type === 'empty' ? 'Empty' : 'Categorical/other');
}