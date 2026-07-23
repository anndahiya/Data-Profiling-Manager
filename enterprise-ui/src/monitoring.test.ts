import { describe, expect, it } from 'vitest';
import { buildScheduledWorkflow, cadenceToCron, monitorBreaches, policiesToCsv, qualityConfigJson } from './monitoring';
import type { MonitorPolicy, WorkspaceSnapshot } from './types';

function policy(overrides: Partial<MonitorPolicy> = {}): MonitorPolicy {
  return {
    id: 'monitor-1', datasetId: 'customer', enabled: true, sourcePath: '/data/customer.csv', recipientName: 'Steward',
    recipientEmail: 'steward@example.com', cadence: 'Monthly', weekday: 'Monday', dayOfMonth: 1, month: 1,
    hourUtc: 7, minute: 0, deliveryMode: 'breach-only', attachReport: true, aiSummary: false,
    maximumMissingPercent: 5, maximumDuplicateRows: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01',
    ...overrides,
  };
}

describe('monitoring configuration', () => {
  it('converts supported cadences to UTC cron expressions', () => {
    expect(cadenceToCron(policy())).toBe('0 7 1 * *');
    expect(cadenceToCron(policy({ cadence: 'Weekly', weekday: 'Friday', hourUtc: 14, minute: 30 }))).toBe('30 14 * * 5');
    expect(cadenceToCron(policy({ cadence: 'Quarterly', dayOfMonth: 10 }))).toBe('0 7 10 1,4,7,10 *');
  });

  it('exports schedule thresholds delivery settings and modern actions', () => {
    const csv = policiesToCsv([policy()], [{ id: 'customer', name: 'Customers', owner: '', description: '', tags: [], createdAt: '', updatedAt: '' }]);
    expect(csv).toContain('delivery_mode');
    expect(csv).toContain('breach-only');
    expect(csv).toContain('maximum_missing_percent');
    const workflow = buildScheduledWorkflow([policy()]);
    expect(workflow).toContain('actions/checkout@v6');
    expect(workflow).toContain('python monthly_profiling_agent.py --cron');
  });

  it('exports governed rules without source rows or credentials', () => {
    const workspace: WorkspaceSnapshot = {
      datasets: [], runs: [], issues: [], monitors: [],
      dimensions: [{ id: 'validity', name: 'Validity', description: 'Valid', weight: 1, enabled: true, source: 'Standard', createdAt: '', updatedAt: '' }],
      rules: [{ id: 'rule-1', datasetId: 'customer', name: 'ID type', dimension: 'Validity', columnName: 'id', ruleType: 'type', expectedValue: 'integer', enabled: true, source: 'User', weight: 1, threshold: 95, severity: 'High', createdAt: '' }],
    };
    const exported = qualityConfigJson(workspace);
    expect(exported).toContain('ID type');
    expect(exported).not.toContain('password');
    expect(exported).not.toContain('sourcePath');
  });

  it('previews current browser-side threshold breaches', () => {
    const latest = {
      id: 'run-2', datasetId: 'customer', fileName: 'customer.csv', createdAt: new Date().toISOString(), rowCount: 100,
      columnCount: 2, duplicateRows: 2, missingCells: 20, missingPercentage: 10, schemaFingerprint: '', columns: [], sourceKind: 'CSV' as const,
      quality: { evaluatedRecords: 100, passingRecords: 50, failingRecords: 50, overallScore: 80, recordComplianceScore: 50, dimensions: [], rulesEvaluated: 2, scoringMethod: 'weighted-rule-average' as const },
    };
    const breaches = monitorBreaches(policy({ minimumOverallQuality: 95 }), latest);
    expect(breaches.some((item) => item.includes('Overall quality'))).toBe(true);
    expect(breaches.some((item) => item.includes('Missing cells'))).toBe(true);
    expect(breaches.some((item) => item.includes('duplicate rows'))).toBe(true);
  });
});
