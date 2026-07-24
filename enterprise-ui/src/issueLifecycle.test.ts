import { describe, expect, it } from 'vitest';
import { reconcileIssueSet } from './issueLifecycle';
import type { Issue } from './types';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 'issue-1', datasetId: 'asset-1', runId: 'run-1', category: 'Data quality', severity: 'High', status: 'Open',
    title: 'Email required fell below 95%', description: '10 records failed.', createdAt: '2026-07-01T00:00:00.000Z', metric: 'Email required',
    issueKey: 'dq:rule-email', firstDetectedAt: '2026-07-01T00:00:00.000Z', lastDetectedAt: '2026-07-01T00:00:00.000Z', occurrenceCount: 1,
    ...overrides,
  };
}

describe('issue lifecycle reconciliation', () => {
  it('updates a recurring active issue instead of creating duplicates', () => {
    const generated = issue({ id: 'new-id', runId: 'run-2', currentValue: '80%' });
    const plan = reconcileIssueSet([issue()], [generated], 'run-2', '2026-07-02T00:00:00.000Z', ['Data quality']);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].id).toBe('issue-1');
    expect(plan.upserts[0].occurrenceCount).toBe(2);
    expect(plan.upserts[0].latestRunId).toBe('run-2');
    expect(plan.resolutions).toHaveLength(0);
  });

  it('resolves active managed issues that no longer recur', () => {
    const plan = reconcileIssueSet([issue()], [], 'run-2', '2026-07-02T00:00:00.000Z', ['Data quality']);
    expect(plan.upserts).toHaveLength(0);
    expect(plan.resolutions[0].status).toBe('Resolved');
    expect(plan.resolutions[0].resolvedAt).toBe('2026-07-02T00:00:00.000Z');
  });

  it('does not resolve categories managed by another execution path', () => {
    const freshness = issue({ category: 'Freshness', issueKey: 'observability:freshness:source' });
    const plan = reconcileIssueSet([freshness], [], 'run-2', '2026-07-02T00:00:00.000Z', ['Data quality']);
    expect(plan.resolutions).toHaveLength(0);
  });
});
