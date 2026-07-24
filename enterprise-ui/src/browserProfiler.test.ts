import { describe, expect, it } from 'vitest';
import { enhanceProfileRun } from './advancedProfiler';
import { profileBrowserRows } from './browserProfiler';

describe('hardened browser profiler', () => {
  it('keeps leading-zero identifiers as source text while inferring their observed type', () => {
    const run = profileBrowserRows([{ customer_id: '00123' }, { customer_id: '00456' }], 'customer', 'customers.csv', 'CSV');
    expect(run.columns[0].inferredType).toBe('integer');
    expect(run.columns[0].patterns[0]?.pattern).toBe('99999');
  });

  it('does not silently treat business values such as unknown, NA, and none as missing', () => {
    const run = profileBrowserRows([
      { status: 'unknown' },
      { status: 'NA' },
      { status: 'none' },
      { status: '' },
    ], 'customer', 'customers.csv', 'CSV');
    expect(run.columns[0].nonNullCount).toBe(3);
    expect(run.columns[0].missingCount).toBe(1);
  });

  it('does not convert blank numeric values to zero in distribution-shape calculations', () => {
    const rows = [{ amount: '1' }, { amount: '' }, { amount: '2' }, { amount: '3' }];
    const run = enhanceProfileRun(rows, profileBrowserRows(rows, 'customer', 'customers.csv', 'CSV'));
    expect(run.columns[0].numericStats?.mean).toBe(2);
    expect(run.columns[0].numericStats?.skewness).toBe(0);
  });

  it('redacts raw top values before a profile is saved', () => {
    const rows = [{ state: 'NC' }, { state: 'NC' }, { state: 'VA' }];
    const run = enhanceProfileRun(rows, profileBrowserRows(rows, 'customer', 'customers.csv', 'CSV'));
    expect(run.columns[0].topValues).toEqual([]);
    expect(run.columns[0].patterns.length).toBeGreaterThan(0);
  });
});