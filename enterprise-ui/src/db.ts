import Dexie, { type EntityTable } from 'dexie';
import type { Dataset, Issue, LinkedSourceHandle, ProfileRun, QualityRule } from './types';

class DpmDatabase extends Dexie {
  datasets!: EntityTable<Dataset, 'id'>;
  runs!: EntityTable<ProfileRun, 'id'>;
  issues!: EntityTable<Issue, 'id'>;
  rules!: EntityTable<QualityRule, 'id'>;
  sourceHandles!: EntityTable<LinkedSourceHandle, 'datasetId'>;

  constructor() {
    super('data-profiling-manager-enterprise');
    this.version(1).stores({
      datasets: 'id, name, updatedAt, latestRunId',
      runs: 'id, datasetId, createdAt, schemaFingerprint',
      issues: 'id, datasetId, runId, category, severity, status, createdAt',
      rules: 'id, datasetId, dimension, columnName, enabled',
    });
    this.version(2).stores({
      datasets: 'id, name, updatedAt, latestRunId',
      runs: 'id, datasetId, createdAt, schemaFingerprint',
      issues: 'id, datasetId, runId, category, severity, status, createdAt',
      rules: 'id, datasetId, dimension, columnName, enabled',
      sourceHandles: 'datasetId, kind, updatedAt',
    });
  }
}

export const db = new DpmDatabase();

export async function clearWorkspace(): Promise<void> {
  await db.transaction('rw', db.datasets, db.runs, db.issues, db.rules, db.sourceHandles, async () => {
    await Promise.all([
      db.datasets.clear(),
      db.runs.clear(),
      db.issues.clear(),
      db.rules.clear(),
      db.sourceHandles.clear(),
    ]);
  });
}
