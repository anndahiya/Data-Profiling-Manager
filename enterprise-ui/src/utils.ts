import type { DimensionResult, ProfileRun, WorkspaceSnapshot } from './types';

export const CHART_COLORS = ['#5b5bd6', '#8b5cf6', '#0ea5a4', '#d97706', '#db2777'];

export function formatDate(value?: string): string {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(value));
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1,
  }).format(value);
}

export function latestRunFor(datasetId: string, runs: ProfileRun[]): ProfileRun | undefined {
  return runs.filter((run) => run.datasetId === datasetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function weightedQuality(runs: ProfileRun[]): number {
  const evaluated = runs.reduce((sum, run) => sum + run.quality.evaluatedRecords, 0);
  const passing = runs.reduce((sum, run) => sum + run.quality.passingRecords, 0);
  return evaluated ? (passing / evaluated) * 100 : 0;
}

export function weightedOverallQuality(workspace: WorkspaceSnapshot): number {
  const latest = workspace.datasets.map((dataset) => latestRunFor(dataset.id, workspace.runs)).filter(Boolean) as ProfileRun[];
  return weightedQuality(latest);
}

export function workspaceQualityTrend(workspace: WorkspaceSnapshot): Array<{ date: string; quality: number; evaluatedRecords: number }> {
  const chronological = [...workspace.runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latestByDataset = new Map<string, ProfileRun>();
  return chronological.map((run) => {
    latestByDataset.set(run.datasetId, run);
    const active = [...latestByDataset.values()];
    return {
      date: new Date(run.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      quality: Number(weightedQuality(active).toFixed(1)),
      evaluatedRecords: active.reduce((sum, item) => sum + item.quality.evaluatedRecords, 0),
    };
  });
}

export function weightedDimensions(workspace: WorkspaceSnapshot): Array<{ dimension: string; score: number }> {
  const latest = workspace.datasets.map((dataset) => latestRunFor(dataset.id, workspace.runs)).filter(Boolean) as ProfileRun[];
  const names = ['Completeness', 'Validity', 'Uniqueness', 'Consistency', 'Timeliness'];
  return names.map((dimension) => {
    const results = latest
      .map((run) => run.quality.dimensions.find((item) => item.dimension === dimension))
      .filter((item): item is DimensionResult => Boolean(item));
    const evaluated = results.reduce((sum, result) => sum + result.passingRecords + result.failingRecords, 0);
    const passing = results.reduce((sum, result) => sum + result.passingRecords, 0);
    return { dimension, score: evaluated ? (passing / evaluated) * 100 : 0 };
  }).filter((item) => item.score > 0);
}
