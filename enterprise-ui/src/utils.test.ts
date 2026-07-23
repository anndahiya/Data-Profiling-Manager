import { describe, expect, it } from 'vitest';
import type { Dataset, ProfileRun, WorkspaceSnapshot } from './types';
import { workspaceQualityTrend, weightedOverallQuality } from './utils';

function dataset(id: string): Dataset {
  return { id, name: id, description: '', owner: '', tags: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
}

function run(id: string, datasetId: string, createdAt: string, passing: number, evaluated: number): ProfileRun {
  return {
    id,
    datasetId,
    fileName: `${id}.csv`,
    createdAt,
    rowCount: evaluated,
    columnCount: 1,
    duplicateRows: 0,
    missingCells: 0,
    missingPercentage: 0,
    schemaFingerprint: 'id:integer',
    columns: [],
    sourceKind: 'CSV',
    quality: {
      evaluatedRecords: evaluated,
      passingRecords: passing,
      failingRecords: evaluated - passing,
      overallScore: evaluated ? passing / evaluated * 100 : 100,
      dimensions: [],
      rulesEvaluated: 1,
    },
  };
}

describe('workspace quality aggregation', () => {
  it('weights overall quality by evaluated records instead of averaging dataset percentages', () => {
    const workspace: WorkspaceSnapshot = {
      datasets: [dataset('small'), dataset('large')],
      runs: [
        run('small-run', 'small', '2026-01-01T00:00:00Z', 10, 10),
        run('large-run', 'large', '2026-01-02T00:00:00Z', 50, 100),
      ],
      issues: [],
      rules: [],
    };
    expect(weightedOverallQuality(workspace)).toBeCloseTo(54.545, 2);
  });

  it('recalculates the workspace trend from the latest run of every asset at each point in time', () => {
    const workspace: WorkspaceSnapshot = {
      datasets: [dataset('a'), dataset('b')],
      runs: [
        run('a-1', 'a', '2026-01-01T00:00:00Z', 80, 100),
        run('b-1', 'b', '2026-01-02T00:00:00Z', 100, 100),
        run('a-2', 'a', '2026-01-03T00:00:00Z', 100, 100),
      ],
      issues: [],
      rules: [],
    };
    const trend = workspaceQualityTrend(workspace);
    expect(trend.map((point) => point.quality)).toEqual([80, 90, 100]);
    expect(trend[2].evaluatedRecords).toBe(200);
  });
});
