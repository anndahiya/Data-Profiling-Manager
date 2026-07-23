import { describe, expect, it } from 'vitest';
import { compareSchema, profileRows, type DataRow } from './profiler';

function makeRows(rows: Array<Record<string, unknown>>): DataRow[] {
  return rows;
}

describe('profiling and DQ evaluation', () => {
  it('calculates overall quality as record-level pass-all, not a dimension average', () => {
    const run = profileRows(
      makeRows([
        { customer_id: 1, email: 'a@example.com', updated_at: new Date() },
        { customer_id: 2, email: null, updated_at: new Date() },
        { customer_id: 2, email: 'bad-format', updated_at: new Date('2020-01-01') },
      ]),
      'customer',
      'customer.csv',
      'CSV',
    );

    const lowestDimension = Math.min(...run.quality.dimensions.map((dimension) => dimension.score));
    expect(run.quality.overallScore).toBeLessThanOrEqual(lowestDimension);
    expect(run.quality.passingRecords + run.quality.failingRecords).toBe(run.rowCount);
  });

  it('detects added, removed, and datatype changes between runs', () => {
    const previous = profileRows(
      makeRows([{ id: 1, state: 'NC', amount: 10 }]),
      'orders',
      'before.csv',
      'CSV',
    );
    const next = profileRows(
      makeRows([{ id: 'A-1', amount: 10, segment: 'Retail' }]),
      'orders',
      'after.csv',
      'CSV',
    );

    const diff = compareSchema(previous, next.columns);
    expect(diff.added).toEqual(['segment']);
    expect(diff.removed).toEqual(['state']);
    expect(diff.changed).toEqual([{ name: 'id', before: 'integer', after: 'text' }]);
    expect(diff.hasChanges).toBe(true);
  });

  it('treats null-like values as missing and detects duplicate rows', () => {
    const run = profileRows(
      makeRows([
        { id: 1, state: 'NC' },
        { id: 1, state: 'NC' },
        { id: 3, state: 'N/A' },
      ]),
      'sample',
      'sample.csv',
      'CSV',
    );

    expect(run.duplicateRows).toBe(1);
    expect(run.columns.find((column) => column.name === 'state')?.missingCount).toBe(1);
  });

  it('only infers uniqueness rules for identifier-shaped columns', () => {
    const run = profileRows(
      makeRows([
        { customer_id: 1, annual_income: 51000, updated_at: '2026-07-20' },
        { customer_id: 2, annual_income: 62000, updated_at: '2026-07-21' },
        { customer_id: 3, annual_income: 73000, updated_at: '2026-07-22' },
      ]),
      'customer',
      'customer.csv',
      'CSV',
    );

    expect(run.columns.find((column) => column.name === 'customer_id')?.likelyKey).toBe(true);
    expect(run.columns.find((column) => column.name === 'annual_income')?.likelyKey).toBe(false);
    expect(run.columns.find((column) => column.name === 'updated_at')?.likelyKey).toBe(false);
    expect(run.quality.dimensions.find((dimension) => dimension.dimension === 'Uniqueness')?.activeRules).toBe(1);
  });
});
