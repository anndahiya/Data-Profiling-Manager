import { db } from './db';
import type { WorkspaceSettings } from './types';

const CREATED_AT = '2026-07-24T00:00:00.000Z';

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  id: 'workspace',
  autoCleanupEnabled: true,
  maxRunsPerAsset: 25,
  resolvedIssueRetentionDays: 90,
  failedRunRetentionDays: 30,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

export interface RetentionResult {
  deletedRuns: number;
  deletedIssues: number;
  deletedFailures: number;
}

export function normalizeWorkspaceSettings(settings?: Partial<WorkspaceSettings>): WorkspaceSettings {
  return {
    ...DEFAULT_WORKSPACE_SETTINGS,
    ...settings,
    id: 'workspace',
    autoCleanupEnabled: settings?.autoCleanupEnabled ?? DEFAULT_WORKSPACE_SETTINGS.autoCleanupEnabled,
    maxRunsPerAsset: Math.min(500, Math.max(1, Math.floor(Number(settings?.maxRunsPerAsset ?? DEFAULT_WORKSPACE_SETTINGS.maxRunsPerAsset)))),
    resolvedIssueRetentionDays: Math.min(3650, Math.max(1, Math.floor(Number(settings?.resolvedIssueRetentionDays ?? DEFAULT_WORKSPACE_SETTINGS.resolvedIssueRetentionDays)))),
    failedRunRetentionDays: Math.min(3650, Math.max(1, Math.floor(Number(settings?.failedRunRetentionDays ?? DEFAULT_WORKSPACE_SETTINGS.failedRunRetentionDays))),
    createdAt: settings?.createdAt ?? DEFAULT_WORKSPACE_SETTINGS.createdAt,
    updatedAt: settings?.updatedAt ?? new Date().toISOString(),
  };
}

export async function ensureWorkspaceSettings(): Promise<WorkspaceSettings> {
  const existing = await db.settings.get('workspace');
  if (existing) return normalizeWorkspaceSettings(existing);
  const settings = normalizeWorkspaceSettings();
  await db.settings.put(settings);
  return settings;
}

export async function applyRetentionPolicy(settingsInput?: WorkspaceSettings, force = false): Promise<RetentionResult> {
  const settings = normalizeWorkspaceSettings(settingsInput ?? await ensureWorkspaceSettings());
  if (!force && !settings.autoCleanupEnabled) return { deletedRuns: 0, deletedIssues: 0, deletedFailures: 0 };

  const [datasets, runs, issues, failures] = await Promise.all([db.datasets.toArray(), db.runs.toArray(), db.issues.toArray(), db.failures.toArray()]);
  const runIdsToDelete: string[] = [];
  datasets.forEach((dataset) => {
    const assetRuns = runs.filter((run) => run.datasetId === dataset.id).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    runIdsToDelete.push(...assetRuns.slice(settings.maxRunsPerAsset).map((run) => run.id));
  });

  const issueCutoff = Date.now() - settings.resolvedIssueRetentionDays * 86_400_000;
  const issueIdsToDelete = issues.filter((issue) => {
    if (issue.status !== 'Resolved' && issue.status !== 'Closed') return false;
    const timestamp = Date.parse(issue.resolvedAt ?? issue.lastDetectedAt ?? issue.createdAt);
    return Number.isFinite(timestamp) && timestamp < issueCutoff;
  }).map((issue) => issue.id);

  const failureCutoff = Date.now() - (settings.failedRunRetentionDays ?? DEFAULT_WORKSPACE_SETTINGS.failedRunRetentionDays!) * 86_400_000;
  const failureIdsToDelete = failures.filter((failure) => {
    const timestamp = Date.parse(failure.failedAt);
    return Number.isFinite(timestamp) && timestamp < failureCutoff;
  }).map((failure) => failure.id);

  await db.transaction('rw', [db.runs, db.issues, db.failures], async () => {
    if (runIdsToDelete.length) await db.runs.bulkDelete(runIdsToDelete);
    if (issueIdsToDelete.length) await db.issues.bulkDelete(issueIdsToDelete);
    if (failureIdsToDelete.length) await db.failures.bulkDelete(failureIdsToDelete);
  });
  return { deletedRuns: runIdsToDelete.length, deletedIssues: issueIdsToDelete.length, deletedFailures: failureIdsToDelete.length };
}
