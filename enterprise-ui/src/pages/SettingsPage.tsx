import { useRef, useState } from 'react';
import { AlertTriangle, Check, FileBarChart, FileUp, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components';
import { clearWorkspace, db } from '../db';
import { demoWorkspace } from '../demo';
import type { WorkspaceSnapshot } from '../types';

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['datasets', 'runs', 'issues', 'rules'].every((key) => Array.isArray(record[key]));
}

async function replaceWorkspace(workspace: WorkspaceSnapshot): Promise<void> {
  await db.transaction('rw', [db.datasets, db.runs, db.issues, db.rules, db.dimensions, db.monitors, db.connections, db.sourceHandles], async () => {
    await Promise.all([db.datasets.clear(), db.runs.clear(), db.issues.clear(), db.rules.clear(), db.dimensions.clear(), db.monitors.clear(), db.connections.clear(), db.sourceHandles.clear()]);
    await Promise.all([
      workspace.datasets.length ? db.datasets.bulkPut(workspace.datasets) : Promise.resolve(),
      workspace.runs.length ? db.runs.bulkPut(workspace.runs) : Promise.resolve(),
      workspace.issues.length ? db.issues.bulkPut(workspace.issues) : Promise.resolve(),
      workspace.rules.length ? db.rules.bulkPut(workspace.rules) : Promise.resolve(),
      workspace.dimensions?.length ? db.dimensions.bulkPut(workspace.dimensions) : Promise.resolve(),
      workspace.monitors?.length ? db.monitors.bulkPut(workspace.monitors) : Promise.resolve(),
      workspace.connections?.length ? db.connections.bulkPut(workspace.connections) : Promise.resolve(),
    ]);
  });
}

export function SettingsPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
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
      if (!window.confirm('Restore this backup and replace every asset, run, rule, issue, monitor, and connection currently stored in this browser?')) return;
      await replaceWorkspace(parsed);
      await reload();
      setMessage('Workspace backup restored. Linked local files and folders must be relinked because browser permissions are not portable.');
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'The workspace backup could not be restored.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const clear = async () => { await clearWorkspace(); setConfirming(false); await reload(); };
  return <>
    <PageHeader title="Settings" description="Manage local browser storage, privacy, backups, and demo data." />
    {message && <div className={`alert ${message.startsWith('Workspace backup restored') ? 'success' : 'error'}`}>{message.startsWith('Workspace backup restored') ? <Check size={17} /> : <AlertTriangle size={17} />}{message}</div>}
    <div className="settings-grid"><section className="panel"><div className="panel-heading"><div><h2>Privacy & storage</h2><p>This web build is local-first.</p></div><ShieldCheck size={22} className="accent-icon" /></div><ul className="check-list"><li><Check size={16} /> CSV and .xlsx files are processed in your browser.</li><li><Check size={16} /> Raw rows are not sent to a hosted application server.</li><li><Check size={16} /> Aggregate profiles can contain source-derived top values, ranges, patterns, SQL text, and contact metadata. Treat backups as potentially sensitive.</li><li><Check size={16} /> Aggregate profiles, rules, dimensions, issues, monitors, and non-secret database metadata are stored in IndexedDB.</li><li><Check size={16} /> Database usernames, passwords, private keys, tokens, and SMTP credentials stay in local or runner environment secrets.</li><li><Check size={16} /> A local or self-hosted agent executes database queries and unattended schedules; the browser never connects directly to company databases.</li></ul></section><section className="panel"><div className="panel-heading"><div><h2>Workspace data</h2><p>{workspace.datasets.length} assets · {workspace.runs.length} runs · {workspace.issues.length} issues · {(workspace.monitors ?? []).length} monitors · {(workspace.connections ?? []).length} database connections</p></div></div><div className="stack-actions"><button className="secondary-button" onClick={exportWorkspace}><FileBarChart size={16} /> Export workspace backup</button><button className="secondary-button" onClick={() => inputRef.current?.click()}><FileUp size={16} /> Restore workspace backup</button><input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importWorkspace(event.target.files?.[0])} /><LoadDemoButton afterLoad={reload} /><button className="danger-button" onClick={() => setConfirming(true)}><Trash2 size={16} /> Clear local workspace</button></div></section></div>
    {confirming && <ConfirmDialog title="Clear the entire local workspace?" body="This deletes every saved asset, profile run, issue, rule, dimension configuration, monitor, database connection metadata, and linked source from this browser. Download a backup first if you need to keep them." confirmLabel="Clear workspace" onCancel={() => setConfirming(false)} onConfirm={() => void clear()} />}
  </>;
}

export function LoadDemoButton({ afterLoad }: { afterLoad?: () => Promise<void> }) {
  const navigate = useNavigate();
  const load = async () => {
    const existingCount = await db.datasets.count() + await db.runs.count() + await db.rules.count();
    if (existingCount && !window.confirm('Loading the demo replaces the current browser workspace. Export a backup first if you need to keep your existing assets and history. Continue?')) return;
    await replaceWorkspace(demoWorkspace);
    await afterLoad?.();
    navigate('/overview');
  };
  return <button className="secondary-button" onClick={() => void load()}><Sparkles size={16} /> Load demo workspace</button>;
}

export function ConfirmDialog({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop"><div className="modal-card small"><button className="modal-close" onClick={onCancel}><X size={18} /></button><div className="modal-icon danger"><Trash2 size={22} /></div><h2>{title}</h2><p>{body}</p><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="danger-button" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}