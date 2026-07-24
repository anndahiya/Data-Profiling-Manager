import type { Issue, IssueCategory } from './types';

const ACTIVE_STATUSES = new Set(['Open', 'Acknowledged']);

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function issueIdentity(issue: Issue): string {
  if (issue.issueKey) return issue.issueKey;
  if (issue.category === 'Data quality') return `dq:${slug(issue.metric || issue.title)}`;
  if (issue.category === 'Schema change') return 'observability:schema-change';
  if (issue.category === 'Record volume') return 'observability:record-volume';
  if (issue.category === 'Freshness') return `observability:freshness:${slug(issue.metric || 'source')}`;
  return `observability:anomaly:${slug(issue.metric || issue.title)}`;
}

export interface IssueReconciliationPlan {
  upserts: Issue[];
  resolutions: Issue[];
}

export function reconcileIssueSet(
  existing: Issue[],
  generated: Issue[],
  runId: string,
  detectedAt: string,
  managedCategories: IssueCategory[],
): IssueReconciliationPlan {
  const managed = new Set(managedCategories);
  const activeExisting = existing
    .filter((issue) => managed.has(issue.category) && ACTIVE_STATUSES.has(issue.status))
    .sort((left, right) => (right.lastDetectedAt ?? right.createdAt).localeCompare(left.lastDetectedAt ?? left.createdAt));
  const existingByKey = new Map<string, Issue>();
  activeExisting.forEach((issue) => {
    const key = issueIdentity(issue);
    if (!existingByKey.has(key)) existingByKey.set(key, issue);
  });

  const activeKeys = new Set<string>();
  const upserts = generated.map((generatedIssue) => {
    const key = issueIdentity(generatedIssue);
    activeKeys.add(key);
    const previous = existingByKey.get(key);
    if (!previous) {
      return {
        ...generatedIssue,
        issueKey: key,
        runId,
        latestRunId: runId,
        firstDetectedAt: generatedIssue.firstDetectedAt ?? detectedAt,
        lastDetectedAt: detectedAt,
        occurrenceCount: Math.max(1, generatedIssue.occurrenceCount ?? 1),
        resolvedAt: undefined,
      };
    }
    return {
      ...previous,
      ...generatedIssue,
      id: previous.id,
      issueKey: key,
      status: previous.status === 'Acknowledged' ? 'Acknowledged' as const : 'Open' as const,
      runId,
      latestRunId: runId,
      createdAt: previous.createdAt,
      firstDetectedAt: previous.firstDetectedAt ?? previous.createdAt,
      lastDetectedAt: detectedAt,
      occurrenceCount: Math.max(1, previous.occurrenceCount ?? 1) + 1,
      resolvedAt: undefined,
    };
  });

  const resolutions = activeExisting
    .filter((issue) => !activeKeys.has(issueIdentity(issue)))
    .map((issue) => ({
      ...issue,
      issueKey: issueIdentity(issue),
      status: 'Resolved' as const,
      resolvedAt: detectedAt,
      lastDetectedAt: issue.lastDetectedAt ?? issue.createdAt,
      occurrenceCount: Math.max(1, issue.occurrenceCount ?? 1),
    }));

  return { upserts, resolutions };
}
