import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_SETTINGS, normalizeWorkspaceSettings } from './retention';

describe('workspace retention settings', () => {
  it('uses conservative defaults for a new browser workspace', () => {
    const settings = normalizeWorkspaceSettings();
    expect(settings.autoCleanupEnabled).toBe(true);
    expect(settings.maxRunsPerAsset).toBe(DEFAULT_WORKSPACE_SETTINGS.maxRunsPerAsset);
    expect(settings.resolvedIssueRetentionDays).toBe(DEFAULT_WORKSPACE_SETTINGS.resolvedIssueRetentionDays);
  });

  it('bounds invalid retention values', () => {
    expect(normalizeWorkspaceSettings({ maxRunsPerAsset: 0, resolvedIssueRetentionDays: -10 }).maxRunsPerAsset).toBe(1);
    expect(normalizeWorkspaceSettings({ maxRunsPerAsset: 9999, resolvedIssueRetentionDays: 9999 }).maxRunsPerAsset).toBe(500);
    expect(normalizeWorkspaceSettings({ maxRunsPerAsset: 9999, resolvedIssueRetentionDays: 9999 }).resolvedIssueRetentionDays).toBe(3650);
  });
});
