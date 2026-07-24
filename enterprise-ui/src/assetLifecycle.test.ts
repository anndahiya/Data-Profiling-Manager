import { describe, expect, it } from 'vitest';
import { assetCascadeCounts, buildAssetBackup } from './assetLifecycle';
import type { WorkspaceSnapshot } from './types';

const workspace: WorkspaceSnapshot = {
  datasets: [
    { id: 'asset-1', name: 'Customers', description: '', owner: '', tags: [], createdAt: '', updatedAt: '', source: { mode: 'linked-file', displayName: 'customers.csv' } },
    { id: 'asset-2', name: 'Orders', description: '', owner: '', tags: [], createdAt: '', updatedAt: '' },
  ],
  runs: [{ id: 'run-1', datasetId: 'asset-1', fileName: 'customers.csv', createdAt: '', rowCount: 1, columnCount: 0, duplicateRows: 0, missingCells: 0, missingPercentage: 0, schemaFingerprint: '', columns: [], quality: { evaluatedRecords: 1, passingRecords: 0, failingRecords: 0, overallScore: 0, dimensions: [], rulesEvaluated: 0 }, sourceKind: 'CSV' }],
  issues: [{ id: 'issue-1', datasetId: 'asset-1', runId: 'run-1', category: 'Anomaly', severity: 'Low', status: 'Open', title: 'Outlier', description: '', createdAt: '' }],
  rules: [{ id: 'rule-1', datasetId: 'asset-1', name: 'Required', dimension: 'Completeness', columnName: 'id', ruleType: 'not-null', enabled: true, source: 'User', createdAt: '' }],
  monitors: [{ id: 'monitor-1', datasetId: 'asset-1', enabled: true, sourcePath: '/data/customers.csv', recipientName: 'Steward', recipientEmail: 'steward@example.com', cadence: 'Daily', weekday: 'Monday', dayOfMonth: 1, month: 1, hourUtc: 7, minute: 0, deliveryMode: 'breach-only', attachReport: true, aiSummary: false, createdAt: '', updatedAt: '' }],
  connections: [{ id: 'connection-1', datasetId: 'asset-1', name: 'Customers DB', provider: 'PostgreSQL', host: 'db.example', port: 5432, database: 'customers', secretPrefix: 'CUSTOMERS', query: 'select * from customers', maxRows: 1000, enabled: true, createdAt: '', updatedAt: '' }],
};

describe('asset lifecycle helpers', () => {
  it('summarizes everything that cascade deletion removes', () => {
    expect(assetCascadeCounts(workspace, 'asset-1')).toEqual({ runs: 1, issues: 1, rules: 1, monitors: 1, connections: 1, linkedSources: 1 });
  });

  it('creates a portable backup containing only the selected asset data', () => {
    const backup = buildAssetBackup(workspace, 'asset-1');
    expect(backup.datasets.map((item) => item.id)).toEqual(['asset-1']);
    expect(backup.runs).toHaveLength(1);
    expect(backup.issues).toHaveLength(1);
    expect(backup.rules).toHaveLength(1);
    expect(backup.monitors).toHaveLength(1);
    expect(backup.connections).toHaveLength(1);
  });
});
