import { db } from './db';
import type { WorkspaceSnapshot } from './types';

export interface AssetCascadeCounts {
  runs: number;
  failures: number;
  issues: number;
  rules: number;
  monitors: number;
  connections: number;
  linkedSources: number;
}

export function assetCascadeCounts(workspace: WorkspaceSnapshot, datasetId: string): AssetCascadeCounts {
  return {
    runs: workspace.runs.filter((item) => item.datasetId === datasetId).length,
    failures: (workspace.failures ?? []).filter((item) => item.datasetId === datasetId).length,
    issues: workspace.issues.filter((item) => item.datasetId === datasetId).length,
    rules: workspace.rules.filter((item) => item.datasetId === datasetId).length,
    monitors: (workspace.monitors ?? []).filter((item) => item.datasetId === datasetId).length,
    connections: (workspace.connections ?? []).filter((item) => item.datasetId === datasetId).length,
    linkedSources: workspace.datasets.some((item) => item.id === datasetId && (item.source?.mode === 'linked-file' || item.source?.mode === 'linked-folder')) ? 1 : 0,
  };
}

export function buildAssetBackup(workspace: WorkspaceSnapshot, datasetId: string): WorkspaceSnapshot {
  const dataset = workspace.datasets.find((item) => item.id === datasetId);
  if (!dataset) throw new Error('The selected data asset no longer exists.');
  return {
    datasets: [dataset],
    runs: workspace.runs.filter((item) => item.datasetId === datasetId),
    failures: (workspace.failures ?? []).filter((item) => item.datasetId === datasetId),
    issues: workspace.issues.filter((item) => item.datasetId === datasetId),
    rules: workspace.rules.filter((item) => item.datasetId === datasetId),
    dimensions: workspace.dimensions,
    monitors: (workspace.monitors ?? []).filter((item) => item.datasetId === datasetId),
    connections: (workspace.connections ?? []).filter((item) => item.datasetId === datasetId),
    settings: workspace.settings,
  };
}

export async function deleteAssetCascade(datasetId: string): Promise<AssetCascadeCounts> {
  const [runs, failures, issues, rules, monitors, connections, handle] = await Promise.all([
    db.runs.where('datasetId').equals(datasetId).toArray(),
    db.failures.where('datasetId').equals(datasetId).toArray(),
    db.issues.where('datasetId').equals(datasetId).toArray(),
    db.rules.where('datasetId').equals(datasetId).toArray(),
    db.monitors.where('datasetId').equals(datasetId).toArray(),
    db.connections.where('datasetId').equals(datasetId).toArray(),
    db.sourceHandles.get(datasetId),
  ]);
  await db.transaction('rw', [db.datasets, db.runs, db.failures, db.issues, db.rules, db.monitors, db.connections, db.sourceHandles], async () => {
    await Promise.all([
      db.datasets.delete(datasetId),
      runs.length ? db.runs.bulkDelete(runs.map((item) => item.id)) : Promise.resolve(),
      failures.length ? db.failures.bulkDelete(failures.map((item) => item.id)) : Promise.resolve(),
      issues.length ? db.issues.bulkDelete(issues.map((item) => item.id)) : Promise.resolve(),
      rules.length ? db.rules.bulkDelete(rules.map((item) => item.id)) : Promise.resolve(),
      monitors.length ? db.monitors.bulkDelete(monitors.map((item) => item.id)) : Promise.resolve(),
      connections.length ? db.connections.bulkDelete(connections.map((item) => item.id)) : Promise.resolve(),
      db.sourceHandles.delete(datasetId),
    ]);
  });
  return { runs: runs.length, failures: failures.length, issues: issues.length, rules: rules.length, monitors: monitors.length, connections: connections.length, linkedSources: handle ? 1 : 0 };
}
