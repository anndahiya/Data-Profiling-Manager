import { useState } from 'react';
import { Check, FileBarChart, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components';
import { clearWorkspace, db } from '../db';
import { demoWorkspace } from '../demo';
import type { WorkspaceSnapshot } from '../types';

export function SettingsPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const exportWorkspace = () => {
    const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = 'data-profiling-manager-workspace.json';
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const clear = async () => { await clearWorkspace(); setConfirming(false); await reload(); };
  return <>
    <PageHeader title="Settings" description="Manage local browser storage, privacy, backups, and demo data." />
    <div className="settings-grid"><section className="panel"><div className="panel-heading"><div><h2>Privacy & storage</h2><p>This web build is local-first.</p></div><ShieldCheck size={22} className="accent-icon" /></div><ul className="check-list"><li><Check size={16} /> CSV and .xlsx files are processed in your browser.</li><li><Check size={16} /> Raw rows are not sent to a hosted application server.</li><li><Check size={16} /> Aggregate profiles, rules, dimensions, issues, monitors, and non-secret database metadata are stored in IndexedDB.</li><li><Check size={16} /> Database usernames, passwords, private keys, tokens, and SMTP credentials stay in local or runner environment secrets.</li><li><Check size={16} /> A local or self-hosted agent executes database queries and unattended schedules; the browser never connects directly to company databases.</li></ul></section><section className="panel"><div className="panel-heading"><div><h2>Workspace data</h2><p>{workspace.datasets.length} assets · {workspace.runs.length} runs · {workspace.issues.length} issues · {(workspace.monitors ?? []).length} monitors · {(workspace.connections ?? []).length} database connections</p></div></div><div className="stack-actions"><button className="secondary-button" onClick={exportWorkspace}><FileBarChart size={16} /> Export workspace backup</button><LoadDemoButton afterLoad={reload} /><button className="danger-button" onClick={() => setConfirming(true)}><Trash2 size={16} /> Clear local workspace</button></div></section></div>
    {confirming && <ConfirmDialog title="Clear the entire local workspace?" body="This deletes every saved asset, profile run, issue, rule, dimension configuration, monitor, database connection metadata, and linked source from this browser. Download a backup first if you need to keep them." confirmLabel="Clear workspace" onCancel={() => setConfirming(false)} onConfirm={() => void clear()} />}
  </>;
}

export function LoadDemoButton({ afterLoad }: { afterLoad?: () => Promise<void> }) {
  const navigate = useNavigate();
  const load = async () => {
    await db.transaction('rw', [db.datasets, db.runs, db.issues, db.rules, db.monitors, db.connections, db.sourceHandles], async () => {
      await Promise.all([db.datasets.clear(), db.runs.clear(), db.issues.clear(), db.rules.clear(), db.monitors.clear(), db.connections.clear(), db.sourceHandles.clear()]);
      await db.datasets.bulkPut(demoWorkspace.datasets);
      await db.runs.bulkPut(demoWorkspace.runs);
      await db.issues.bulkPut(demoWorkspace.issues);
    });
    await afterLoad?.();
    navigate('/overview');
  };
  return <button className="secondary-button" onClick={() => void load()}><Sparkles size={16} /> Load demo workspace</button>;
}

export function ConfirmDialog({ title, body, confirmLabel, onCancel, onConfirm }: { title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  return <div className="modal-backdrop"><div className="modal-card small"><button className="modal-close" onClick={onCancel}><X size={18} /></button><div className="modal-icon danger"><Trash2 size={22} /></div><h2>{title}</h2><p>{body}</p><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="danger-button" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}