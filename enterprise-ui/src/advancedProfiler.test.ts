import { describe, expect, it } from 'vitest';
import { enhanceProfileRun } from './advancedProfiler';
import { profileRows, type DataRow } from './profiler';

function rows(values: DataRow[]): DataRow[] { return values; }

describe('advanced profiling parity', () => {
  it('adds distribution shape cardinality classifications and memory metrics', () => {
    const input = rows([
      { customer_id: 1, amount: 10, state: 'NC', constant: 'A', event_date: '2026-01-01' },
      { customer_id: 2, amount: 20, state: 'NC', constant: 'A', event_date: '2026-01-02' },
      { customer_id: 3, amount: 100, state: 'VA', constant: 'A', event_date: '2026-01-04' },
    ]);
    const run = enhanceProfileRun(input, profileRows(input, 'customer', 'customer.csv', 'CSV'));

    expect(run.memoryUsageMB).toBeGreaterThan(0);
    expect(run.numericColumnCount).toBe(2);
    expect(run.columns.find((column) => column.name === 'customer_id')?.classification).toBe('Likely key');
    expect(run.columns.find((column) => column.name === 'constant')?.classification).toBe('Constant');
    expect(run.columns.find((column) => column.name === 'amount')?.numericStats?.skewness).toBeTypeOf('number');
    expect(run.columns.find((column) => column.name === 'state')?.textStats?.maxLength).toBe(2);
    expect(run.columns.find((column) => column.name === 'event_date')?.dateStats?.rangeDays).toBe(3);
  });

  it('calculates pairwise Pearson correlations for numeric columns', () => {
    const input = rows([
      { x: 1, y: 2, z: 9 },
      { x: 2, y: 4, z: 8 },
      { x: 3, y: 6, z: 7 },
      { x: 4, y: 8, z: 6 },
    ]);
    const run = enhanceProfileRun(input, profileRows(input, 'sample', 'sample.csv', 'CSV'));
    const xy = run.correlations?.find((item) => item.left === 'x' && item.right === 'y');
    const xz = run.correlations?.find((item) => item.left === 'x' && item.right === 'z');
    expect(xy?.value).toBe(1);
    expect(xz?.value).toBe(-1);
  });
});
