import { describe, expect, it } from 'vitest';
import { compareSchema, profileRows, type DataRow } from './profiler';
import { evaluateConfiguredQuality } from './quality';
import type { QualityDimension, QualityRule } from './types';

function makeRows(rows: Array<Record<string, unknown>>): DataRow[] {
  return rows;
}

function dimension(name: string, weight = 1): QualityDimension {
  return { id: name.toLowerCase(), name, description: name, weight, enabled: true, source: 'User', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
}

function rule(value: Partial<QualityRule> & Pick<QualityRule, 'name' | 'dimension' | 'columnName' | 'ruleType'>): QualityRule {
  return { id: crypto.randomUUID(), datasetId: 'customer', enabled: true, source: 'User', createdAt: '2026-01-01', weight: 1, threshold: 95, severity: 'Medium', ...value };
}

describe('profiling and DQ evaluation', () => {
  it('keeps weighted quality separate from strict record compliance', () => {
    const rows = makeRows([
      { email: null, status: 'Active' },
      { email: null, status: 'Active' },
    ]);
    const base = profileRows(rows, 'customer', 'customer.csv', 'CSV');
    const quality = evaluateConfiguredQuality(rows, base.columns, [
      rule({ name: 'Email is required', dimension: 'Completeness', columnName: 'email', ruleType: 'not-null' }),
      rule({ name: 'Status is text', dimension: 'Validity', columnName: 'status', ruleType: 'type', expectedValue: 'text' }),
    ], [dimension('Completeness'), dimension('Validity')]);

    expect(quality.dimensions.find((item) => item.dimension === 'Completeness')?.score).toBe(0);
    expect(quality.dimensions.find((item) => item.dimension === 'Validity')?.score).toBe(100);
    expect(quality.overallScore).toBe(50);
    expect(quality.recordComplianceScore).toBe(0);
    expect(quality.passingRecords).toBe(0);
  });

  it('uses rule weights within a dimension and dimension weights overall', () => {
    const rows = makeRows([{ amount: 10 }, { amount: 200 }]);
    const base = profileRows(rows, 'orders', 'orders.csv', 'CSV');
    const quality = evaluateConfiguredQuality(rows, base.columns, [
      rule({ name: 'Amount under 100', dimension: 'Business fit', columnName: 'amount', ruleType: 'range', expectedValue: '0', secondaryValue: '100', weight: 3 }),
      rule({ name: 'Amount is numeric', dimension: 'Validity', columnName: 'amount', ruleType: 'type', expectedValue: 'integer', weight: 1 }),
    ], [dimension('Business fit', 2), dimension('Validity', 1)]);

    expect(quality.dimensions.find((item) => item.dimension === 'Business fit')?.score).toBe(50);
    expect(quality.dimensions.find((item) => item.dimension === 'Validity')?.score).toBe(100);
    expect(quality.overallScore).toBeCloseTo(66.666, 2);
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
    expect(run.quality.dimensions.find((item) => item.dimension === 'Uniqueness')?.activeRules).toBe(1);
  });
});