import { hasGovernedQuality } from './scoring';
import type { DimensionResult, ProfileRun, WorkspaceSnapshot } from './types';

export const CHART_COLORS = ['#5b5bd6', '#8b5cf6', '#0ea5a4', '#d97706', '#db2777', '#2563eb', '#7c3aed', '#059669'];

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

function weightedQuality(runs: ProfileRun[]): number | undefined {
  const governed = runs.filter((run) => hasGovernedQuality(run.quality));
  const evaluated = governed.reduce((sum, run) => sum + Math.max(1, run.quality.evaluatedRecords), 0);
  const score = governed.reduce((sum, run) => sum + run.quality.overallScore * Math.max(1, run.quality.evaluatedRecords), 0);
  return evaluated ? score / evaluated : undefined;
}

export function weightedOverallQuality(workspace: WorkspaceSnapshot): number | undefined {
  const latest = workspace.datasets.map((dataset) => latestRunFor(dataset.id, workspace.runs)).filter(Boolean) as ProfileRun[];
  return weightedQuality(latest);
}

export function workspaceQualityTrend(workspace: WorkspaceSnapshot): Array<{ date: string; quality: number | null; evaluatedRecords: number }> {
  const chronological = [...workspace.runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const latestByDataset = new Map<string, ProfileRun>();
  return chronological.map((run) => {
    latestByDataset.set(run.datasetId, run);
    const active = [...latestByDataset.values()];
    const quality = weightedQuality(active);
    return {
      date: new Date(run.createdAt).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      quality: quality === undefined ? null : Number(quality.toFixed(1)),
      evaluatedRecords: active.filter((item) => hasGovernedQuality(item.quality)).reduce((sum, item) => sum + item.quality.evaluatedRecords, 0),
    };
  });
}

export function weightedDimensions(workspace: WorkspaceSnapshot): Array<{ dimension: string; score: number }> {
  const latestRuns = workspace.datasets.map((dataset) => latestRunFor(dataset.id, workspace.runs)).filter(Boolean) as ProfileRun[];
  const latest = latestRuns.filter((run) => hasGovernedQuality(run.quality));
  const names = [...new Set(latest.flatMap((run) => run.quality.dimensions.map((dimension) => dimension.dimension)))];
  return names.map((dimension) => {
    const results = latest
      .map((run) => ({ run, result: run.quality.dimensions.find((item) => item.dimension === dimension) }))
      .filter((item): item is { run: ProfileRun; result: DimensionResult } => Boolean(item.result));
    const evaluated = results.reduce((sum, item) => sum + Math.max(1, item.run.quality.evaluatedRecords), 0);
    const score = results.reduce((sum, item) => sum + item.result.score * Math.max(1, item.run.quality.evaluatedRecords), 0);
    return { dimension, score: evaluated ? score / evaluated : 0 };
  }).sort((a, b) => a.dimension.localeCompare(b.dimension));
}