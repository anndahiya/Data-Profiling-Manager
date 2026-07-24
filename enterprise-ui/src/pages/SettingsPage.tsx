import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Archive, Check, FileBarChart, FileUp, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PageHeader } from '../components';
import { clearWorkspace, db } from '../db';
import { demoWorkspace } from '../demo';
import { applyRetentionPolicy, normalizeWorkspaceSettings } from '../retention';
import type { WorkspaceSettings, WorkspaceSnapshot } from '../types';

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['datasets', 'runs', 'issues', 'rules'].every((key) => Array.isArray(record[key]));
}

async function replaceWorkspace(workspace: WorkspaceSnapshot): Promise<void> {
  await db.transaction('rw', [db.datasets, db.runs, db.failures, db.issues, db.rules, db.dimensions, db.monitors, db.connections, db.sourceHandles, db.settings], async () => {
    await Promise.all([db.datasets.clear(), db.runs.clear(), db.failures.clear(), db.issues.clear(), db.rules.clear(), db.dimensions.clear(), db.monitors.clear(), db.connections.clear(), db.sourceHandles.clear(), db.settings.clear()]);
    await Promise.all([
      workspace.datasets.length ? db.datasets.bulkPut(workspace.datasets) : Promise.resolve(),
      workspace.runs.length ? db.runs.bulkPut(workspace.runs) : Promise.resolve(),
      workspace.failures?.length ? db.failures.bulkPut(workspace.failures) : Promise.resolve(),
      workspace.issues.length ? db.issues.bulkPut(workspace.issues) : Promise.resolve(),
      workspace.rules.length ? db.rules.bulkPut(workspace.rules) : Promise.resolve(),
      workspace.dimensions?.length ? db.dimensions.bulkPut(workspace.dimensions) : Promise.resolve(),
      workspace.monitors?.length ? db.monitors.bulkPut(workspace.monitors) : Promise.resolve(),
      workspace.connections?.length ? db.connections.bulkPut(workspace.connections) : Promise.resolve(),
      workspace.settings ? db.settings.put(normalizeWorkspaceSettings(workspace.settings)) : Promise.resolve(),
    ]);
  });
}

function cleanupMessage(prefix: string, result: Awaited<ReturnType<typeof applyRetentionPolicy>>): string {
  return `${prefix} ${result.deletedRuns} old run${result.deletedRuns === 1 ? '' : 's'}, ${result.deletedIssues} resolved issue${result.deletedIssues === 1 ? '' : 's'}, and ${result.deletedFailures} failed attempt${result.deletedFailures === 1 ? '' : 's'} removed.`;
}

export function SettingsPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const [retention, setRetention] = useState<WorkspaceSettings>(normalizeWorkspaceSettings(workspace.settings));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setRetention(normalizeWorkspaceSettings(workspace.settings)), [workspace.settings]);

  const exportWorkspace = () => {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'data-profiling-manager-workspace.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const importWorkspace = async (file?: File) => {
    if (!file) return;
    setMessage('');
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isWorkspaceSnapshot(parsed)) throw new Error('This file is not a valid Data Profiling Manager workspace backup.');
      if (!window.confirm('Restore this backup and replace every asset, completed run, failed attempt, rule, issue, monitor, connection, and retention setting currently stored in this browser?')) return;
      await replaceWorkspace(parsed);
      await reload();
      setMessage('Workspace backup restored. Linked local files and folders must be relinked because browser permissions are not portable.');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'The workspace backup could not be restored.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const saveRetention = async () => {
    const next = normalizeWorkspaceSettings({ ...retention, updatedAt: new Date().toISOString() });
    await db.settings.put(next);
    setRetention(next);
    const result = await applyRetentionPolicy(next);
    await reload();
    setMessage(cleanupMessage('Retention settings saved.', result));
  };
  const cleanNow = async () => {
    const next = normalizeWorkspaceSettings({ ...retention, updatedAt: new Date().toISOString() });
    await db.settings.put(next);
    const result = await applyRetentionPolicy(next, true);
    await reload();
    setMessage(cleanupMessage('Cleanup complete.', result));
  };
  const clear = async () => { await clearWorkspace(); setConfirming(false); await reload(); };
  const success = message.startsWith('Workspace backup restored') || message.startsWith('Retention settings saved') || message.startsWith('Cleanup complete');

  return <>
    <PageHeader title="Settings" description="Manage local browser storage, privacy, backups, retention, and demo data." />
    {message && <div className={`alert ${success ? 'success' : 'error'}`} role="status" aria-live="polite">{success ? <Check size={17} /> : <AlertTriangle size={17} />}{message}</div>}
    <div className="settings-grid">
      <section className="panel"><div className="panel-heading"><div><h2>Privacy & storage</h2><p>This web build is local-first.</p></div><ShieldCheck size={22} className="accent-icon" /></div><ul className="check-list"><li><Check size={16} /> CSV and .xlsx files are processed in your browser.</li><li><Check size={16} /> Raw rows are not sent to a hosted application server.</li><li><Check size={16} /> New browser profiles redact raw top-value text; older runs or backups may still contain source-derived aggregates, ranges, patterns, SQL text, and contact metadata.</li><li><Check size={16} /> Aggregate profiles, completed and failed run history, rules, dimensions, issues, monitors, and non-secret database metadata are stored in IndexedDB.</li><li><Check size={16} /> Database usernames, passwords, private keys, tokens, and SMTP credentials stay in local or runner environment secrets.</li><li><Check size={16} /> A local or self-hosted agent executes database queries and unattended schedules; the browser never connects directly to company databases.</li></ul></section>
      <section className="panel"><div className="panel-heading"><div><h2>Workspace data</h2><p>{workspace.datasets.length} assets · {workspace.runs.length} completed runs · {(workspace.failures ?? []).length} failed attempts · {workspace.issues.length} issues · {(workspace.monitors ?? []).length} monitors · {(workspace.connections ?? []).length} database connections</p></div></div><div className="stack-actions"><button className="secondary-button" onClick={exportWorkspace}><FileBarChart size={16} /> Export workspace backup</button><button className="secondary-button" onClick={() => inputRef.current?.click()}><FileUp size={16} /> Restore workspace backup</button><input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importWorkspace(event.target.files?.[0])} /><LoadDemoButton afterLoad={reload} /><button className="danger-button" onClick={() => setConfirming(true)}><Trash2 size={16} /> Clear local workspace</button></div></section>
      <section className="panel retention-panel"><div className="panel-heading"><div><h2>Retention & cleanup</h2><p>Keep the browser workspace useful without allowing history to grow forever.</p></div><Archive size={22} className="accent-icon" /></div><label className="checkbox-row"><input type="checkbox" checked={retention.autoCleanupEnabled} onChange={(event) => setRetention({ ...retention, autoCleanupEnabled: event.target.checked })} /><span><b>Automatically apply retention after profiling</b><small>Cleanup runs after successful profiles and after a failed attempt is logged.</small></span></label><div className="monitor-grid three"><label className="field"><span>Runs retained per asset</span><input type="number" min="1" max="500" value={retention.maxRunsPerAsset} onChange={(event) => setRetention({ ...retention, maxRunsPerAsset: Number(event.target.value) })} /><small>Newest runs are retained. The current latest run is never removed.</small></label><label className="field"><span>Resolved issue retention (days)</span><input type="number" min="1" max="3650" value={retention.resolvedIssueRetentionDays} onChange={(event) => setRetention({ ...retention, resolvedIssueRetentionDays: Number(event.target.value) })} /><small>Open and acknowledged issues are never removed.</small></label><label className="field"><span>Failed attempt retention (days)</span><input type="number" min="1" max="3650" value={retention.failedRunRetentionDays ?? 30} onChange={(event) => setRetention({ ...retention, failedRunRetentionDays: Number(event.target.value) })} /><small>Failure messages contain no raw rows, but can include source names and technical details.</small></label></div><div className="button-row"><button className="primary-button" onClick={() => void saveRetention()}>Save retention settings</button><button className="secondary-button" onClick={() => void cleanNow()}>Run cleanup now</button></div></section>
    </div>
    {confirming && <ConfirmDialog title="Clear the entire local workspace?" body="This deletes every saved asset, completed run, failed attempt, issue, rule, dimension configuration, monitor, database connection metadata, retention setting, and linked source from this browser. Download a backup first if you need to keep them." confirmLabel="Clear workspace" onCancel={() => setConfirming(false)} onConfirm={() => void clear()} />}
  </>;
}

export function LoadDemoButton({ afterLoad }: { afterLoad?: () => Promise<void> }) {
  const navigate = useNavigate();
  const load = async () => {
    const existingCount = await db.datasets.count() + await db.runs.count() + await db.failures.count() + await db.rules.count();
    if (existingCount && !window.confirm('Loading the demo replaces the current browser workspace. Export a backup first if you need to keep your existing assets and history. Continue?')) return;
    await replaceWorkspace(demoWorkspace);
    await afterLoad?.();
    navigate('/overview');
  };
  return <button className="secondary-button" onClick={() => void load()}><Sparkles size={16} /> Load demo workspace</button>;
}

export function ConfirmDialog({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}><div className="modal-card small" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title"><button className="modal-close" aria-label="Close dialog" onClick={onCancel}><X size={18} /></button><div className="modal-icon danger"><Trash2 size={22} /></div><h2 id="confirm-dialog-title">{title}</h2><p>{body}</p><div className="modal-actions"><button ref={cancelRef} className="ghost-button" onClick={onCancel}>Cancel</button><button className="danger-button" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}
