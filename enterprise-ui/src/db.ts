import Dexie, { type EntityTable } from 'dexie';
import type { DatabaseConnection, Dataset, Issue, LinkedSourceHandle, MonitorPolicy, ProfileRun, QualityDimension, QualityRule, WorkspaceSettings } from './types';

class DpmDatabase extends Dexie {
  datasets!: EntityTable<Dataset, 'id'>;
  runs!: EntityTable<ProfileRun, 'id'>;
  issues!: EntityTable<Issue, 'id'>;
  rules!: EntityTable<QualityRule, 'id'>;
  dimensions!: EntityTable<QualityDimension, 'id'>;
  monitors!: EntityTable<MonitorPolicy, 'id'>;
  connections!: EntityTable<DatabaseConnection, 'id'>;
  sourceHandles!: EntityTable<LinkedSourceHandle, 'datasetId'>;
  settings!: EntityTable<WorkspaceSettings, 'id'>;

  constructor() {
    super('data-profiling-manager-enterprise');
    const base = {
      datasets: 'id, name, updatedAt, latestRunId',
      runs: 'id, datasetId, createdAt, schemaFingerprint',
      issues: 'id, datasetId, runId, category, severity, status, createdAt',
      rules: 'id, datasetId, dimension, columnName, enabled',
    };
    this.version(1).stores(base);
    this.version(2).stores({ ...base, sourceHandles: 'datasetId, kind, updatedAt' });
    this.version(3).stores({ ...base, dimensions: 'id, name, enabled, source, updatedAt', sourceHandles: 'datasetId, kind, updatedAt' });
    this.version(4).stores({ ...base, dimensions: 'id, name, enabled, source, updatedAt', monitors: 'id, datasetId, enabled, cadence, updatedAt', sourceHandles: 'datasetId, kind, updatedAt' });
    this.version(5).stores({ ...base, dimensions: 'id, name, enabled, source, updatedAt', monitors: 'id, datasetId, enabled, cadence, updatedAt', connections: 'id, datasetId, provider, enabled, updatedAt', sourceHandles: 'datasetId, kind, updatedAt' });
    this.version(6).stores({ ...base, dimensions: 'id, name, enabled, source, updatedAt', monitors: 'id, datasetId, enabled, cadence, updatedAt', connections: 'id, datasetId, provider, enabled, updatedAt', sourceHandles: 'datasetId, kind, updatedAt', settings: 'id, updatedAt' });
  }
}

export const db = new DpmDatabase();

export async function clearWorkspace(): Promise<void> {
  await db.transaction('rw', [db.datasets, db.runs, db.issues, db.rules, db.dimensions, db.monitors, db.connections, db.sourceHandles, db.settings], async () => {
    await Promise.all([db.datasets.clear(), db.runs.clear(), db.issues.clear(), db.rules.clear(), db.dimensions.clear(), db.monitors.clear(), db.connections.clear(), db.sourceHandles.clear(), db.settings.clear()]);
  });
}
