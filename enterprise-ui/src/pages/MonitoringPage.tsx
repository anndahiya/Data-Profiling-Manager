import { useState } from 'react';
import { BellRing, Download, Pencil, Plus, Power, Trash2, X } from 'lucide-react';
import { PageHeader } from '../components';
import { db } from '../db';
import { buildScheduledWorkflow, cadenceToCron, monitorBreaches, policiesToCsv } from '../monitoring';
import type { DeliveryMode, MonitorPolicy, ScheduleCadence, WorkspaceSnapshot } from '../types';

function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function MonitoringPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const policies = [...(workspace.monitors ?? [])].sort((a, b) => a.datasetId.localeCompare(b.datasetId));
  const [editing, setEditing] = useState<MonitorPolicy | 'new' | null>(null);

  const save = async (policy: MonitorPolicy) => {
    await db.monitors.put(policy);
    setEditing(null);
    await reload();
  };

  const toggle = async (policy: MonitorPolicy) => {
    await db.monitors.update(policy.id, { enabled: !policy.enabled, updatedAt: new Date().toISOString() });
    await reload();
  };

  const remove = async (policy: MonitorPolicy) => {
    const name = workspace.datasets.find((item) => item.id === policy.datasetId)?.name ?? 'this asset';
    if (!window.confirm(`Delete the schedule and thresholds for ${name}?`)) return;
    await db.monitors.delete(policy.id);
    await reload();
  };

  const active = policies.filter((policy) => policy.enabled);
  return <>
    <PageHeader
      title="Monitoring & schedules"
      description="Set thresholds, schedule recurring profiles, and route reports or breach alerts to the responsible steward."
      actions={<button className="primary-button" disabled={!workspace.datasets.length} onClick={() => setEditing('new')}><Plus size={16} /> Add monitor</button>}
    />
    <div className="alert warning"><BellRing size={17} /><span>The browser stores this configuration but cannot read local files or send email after the tab closes. Run the exported configuration locally or through GitHub Actions. SMTP passwords stay in environment secrets.</span></div>
    <div className="metric-grid four">
      <div className="metric-card"><div className="metric-label">Configured monitors</div><div className="metric-value">{policies.length}</div><div className="metric-detail">One policy per data asset</div></div>
      <div className="metric-card"><div className="metric-label">Active schedules</div><div className="metric-value">{active.length}</div><div className="metric-detail">Included in exported workflow</div></div>
      <div className="metric-card"><div className="metric-label">Breach-only delivery</div><div className="metric-value">{active.filter((item) => item.deliveryMode === 'breach-only').length}</div><div className="metric-detail">Suppresses healthy-run email</div></div>
      <div className="metric-card"><div className="metric-label">Steward recipients</div><div className="metric-value">{new Set(active.map((item) => item.recipientEmail).filter(Boolean)).size}</div><div className="metric-detail">Distinct primary recipients</div></div>
    </div>
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-heading"><div><h2>Scheduled-agent files</h2><p>Export these after changing a schedule. Use the CSV with a local scheduler or commit both files to the runner repository.</p></div></div>
      <div className="button-row">
        <button className="secondary-button" disabled={!active.length} onClick={() => downloadText('schedule_config.csv', policiesToCsv(policies, workspace.datasets), 'text/csv')}><Download size={16} /> Download schedule config</button>
        <button className="secondary-button" disabled={!active.length} onClick={() => downloadText('scheduled-profiling.yml', buildScheduledWorkflow(policies), 'text/yaml')}><Download size={16} /> Download GitHub workflow</button>
      </div>
      <ul className="check-list" style={{ marginTop: 16 }}><li>GitHub Actions cron times use UTC.</li><li>Required secrets: SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS.</li><li>Local files need a path available to the machine running the agent.</li></ul>
    </section>
    {policies.length ? <div className="settings-grid">{policies.map((policy) => {
      const dataset = workspace.datasets.find((item) => item.id === policy.datasetId);
      const runs = workspace.runs.filter((run) => run.datasetId === policy.datasetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const breaches = monitorBreaches(policy, runs[0], runs[1]);
      return <section className="panel" key={policy.id}>
        <div className="panel-heading"><div><h2>{dataset?.name ?? 'Unknown asset'}</h2><p>{policy.cadence} · cron {cadenceToCron(policy)} UTC · {policy.deliveryMode === 'breach-only' ? 'Email only on breach' : 'Email every run'}</p></div><span className={`status-chip ${policy.enabled ? 'resolved' : 'closed'}`}>{policy.enabled ? 'Active' : 'Paused'}</span></div>
        <dl className="detail-list"><div><dt>Agent source</dt><dd>{policy.sourcePath || 'Not configured'}</dd></div><div><dt>Primary steward</dt><dd>{policy.recipientName || 'Steward'} · {policy.recipientEmail}</dd></div><div><dt>Minimum quality</dt><dd>{policy.minimumOverallQuality ?? 'Not set'}{policy.minimumOverallQuality !== undefined ? '%' : ''}</dd></div><div><dt>Maximum missing</dt><dd>{policy.maximumMissingPercent ?? 'Not set'}{policy.maximumMissingPercent !== undefined ? '%' : ''}</dd></div><div><dt>Maximum duplicates</dt><dd>{policy.maximumDuplicateRows ?? 'Not set'}</dd></div></dl>
        <div className={`alert ${breaches.length ? 'error' : 'success'}`} style={{ marginTop: 14 }}>{breaches.length ? `${breaches.length} current threshold ${breaches.length === 1 ? 'breach' : 'breaches'}: ${breaches.join(' ')}` : 'Latest saved run is within the configured thresholds.'}</div>
        <div className="button-row"><button className="small-button" onClick={() => void toggle(policy)}><Power size={14} /> {policy.enabled ? 'Pause' : 'Enable'}</button><button className="small-button" onClick={() => setEditing(policy)}><Pencil size={14} /> Edit</button><button className="small-button" onClick={() => void remove(policy)}><Trash2 size={14} /> Delete</button></div>
      </section>;
    })}</div> : <section className="empty-state"><div className="empty-icon"><BellRing size={25} /></div><h2>No monitoring policies yet</h2><p>Add a policy to define the recurring schedule, acceptable thresholds, and who should receive the report or alert.</p><button className="primary-button" disabled={!workspace.datasets.length} onClick={() => setEditing('new')}><Plus size={16} /> Add first monitor</button></section>}
    {editing && <MonitorEditor value={editing === 'new' ? undefined : editing} workspace={workspace} onCancel={() => setEditing(null)} onSave={(policy) => void save(policy)} />}
  </>;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function MonitorEditor({ value, workspace, onCancel, onSave }: { value?: MonitorPolicy; workspace: WorkspaceSnapshot; onCancel: () => void; onSave: (policy: MonitorPolicy) => void }) {
  const defaultDataset = value?.datasetId ?? workspace.datasets.find((dataset) => !(workspace.monitors ?? []).some((policy) => policy.datasetId === dataset.id))?.id ?? workspace.datasets[0]?.id ?? '';
  const [datasetId, setDatasetId] = useState(defaultDataset);
  const selectedDataset = workspace.datasets.find((item) => item.id === datasetId);
  const [enabled, setEnabled] = useState(value?.enabled ?? true);
  const [sourcePath, setSourcePath] = useState(value?.sourcePath ?? (selectedDataset?.source?.mode === 'manual-upload' ? '' : selectedDataset?.source?.displayName ?? ''));
  const [recipientName, setRecipientName] = useState(value?.recipientName ?? selectedDataset?.owner ?? '');
  const [recipientEmail, setRecipientEmail] = useState(value?.recipientEmail ?? '');
  const [ccEmails, setCcEmails] = useState(value?.ccEmails ?? '');
  const [cadence, setCadence] = useState<ScheduleCadence>(value?.cadence ?? 'Monthly');
  const [weekday, setWeekday] = useState(value?.weekday ?? 'Monday');
  const [dayOfMonth, setDayOfMonth] = useState(value?.dayOfMonth ?? 1);
  const [month, setMonth] = useState(value?.month ?? 1);
  const [hourUtc, setHourUtc] = useState(value?.hourUtc ?? 7);
  const [minute, setMinute] = useState(value?.minute ?? 0);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>(value?.deliveryMode ?? 'breach-only');
  const [attachReport, setAttachReport] = useState(value?.attachReport ?? true);
  const [aiSummary, setAiSummary] = useState(value?.aiSummary ?? false);
  const [minimumOverallQuality, setMinimumOverallQuality] = useState(value?.minimumOverallQuality?.toString() ?? '95');
  const [minimumRecordCompliance, setMinimumRecordCompliance] = useState(value?.minimumRecordCompliance?.toString() ?? '');
  const [maximumMissingPercent, setMaximumMissingPercent] = useState(value?.maximumMissingPercent?.toString() ?? '5');
  const [maximumDuplicateRows, setMaximumDuplicateRows] = useState(value?.maximumDuplicateRows?.toString() ?? '0');
  const [maximumRowChangePercent, setMaximumRowChangePercent] = useState(value?.maximumRowChangePercent?.toString() ?? '20');
  const [maximumFreshnessHours, setMaximumFreshnessHours] = useState(value?.maximumFreshnessHours?.toString() ?? '');
  const [error, setError] = useState('');

  const changeDataset = (next: string) => {
    setDatasetId(next);
    const dataset = workspace.datasets.find((item) => item.id === next);
    setRecipientName(dataset?.owner ?? '');
    if (!value) setSourcePath(dataset?.source?.mode === 'manual-upload' ? '' : dataset?.source?.displayName ?? '');
  };

  const save = () => {
    if (!datasetId) return setError('Choose a data asset.');
    if (!sourcePath.trim()) return setError('Enter a path or URL that the scheduled agent can access.');
    if (!recipientEmail.includes('@')) return setError('Enter a valid steward email address.');
    const now = new Date().toISOString();
    onSave({
      id: value?.id ?? crypto.randomUUID(), datasetId, enabled, sourcePath: sourcePath.trim(), recipientName: recipientName.trim() || 'there', recipientEmail: recipientEmail.trim(), ccEmails: ccEmails.trim(), cadence, weekday,
      dayOfMonth: Math.min(28, Math.max(1, dayOfMonth)), month: Math.min(12, Math.max(1, month)), hourUtc: Math.min(23, Math.max(0, hourUtc)), minute: Math.min(59, Math.max(0, minute)),
      deliveryMode, attachReport, aiSummary, minimumOverallQuality: optionalNumber(minimumOverallQuality), minimumRecordCompliance: optionalNumber(minimumRecordCompliance), maximumMissingPercent: optionalNumber(maximumMissingPercent), maximumDuplicateRows: optionalNumber(maximumDuplicateRows), maximumRowChangePercent: optionalNumber(maximumRowChangePercent), maximumFreshnessHours: optionalNumber(maximumFreshnessHours),
      createdAt: value?.createdAt ?? now, updatedAt: now,
    });
  };

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={value ? 'Edit monitor' : 'Add monitoring policy'}>
    <div className="modal-card monitor-modal">
      <button type="button" className="modal-close" onClick={onCancel} aria-label="Close"><X size={18} /></button>
      <div className="monitor-modal-header"><div><span className="eyebrow">Monitoring policy</span><h2>{value ? 'Edit monitor' : 'Add monitor'}</h2><p>Configure the source, schedule, delivery, and alert thresholds. Credentials are never stored here.</p></div></div>
      <div className="monitor-form">
        <section className="monitor-section"><h3>Source</h3><div className="monitor-grid two"><label className="field"><span>Data asset</span><select value={datasetId} onChange={(event) => changeDataset(event.target.value)} disabled={Boolean(value)}>{workspace.datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span>Status</span><select value={enabled ? 'enabled' : 'paused'} onChange={(event) => setEnabled(event.target.value === 'enabled')}><option value="enabled">Enabled</option><option value="paused">Paused</option></select></label></div><label className="field"><span>Agent-accessible path or URL</span><input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="/data/customer.csv or https://…/customer.csv" /><small>Browser-linked handles are not filesystem paths. Enter the source visible to the local agent or runner.</small></label></section>
        <section className="monitor-section"><h3>Recipients & delivery</h3><div className="monitor-grid two"><label className="field"><span>Steward name</span><input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} /></label><label className="field"><span>Steward email</span><input type="email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="steward@company.com" /></label></div><label className="field"><span>CC emails</span><input value={ccEmails} onChange={(event) => setCcEmails(event.target.value)} placeholder="Optional, comma-separated" /></label><div className="monitor-grid three"><label className="field"><span>Email delivery</span><select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as DeliveryMode)}><option value="breach-only">Only on breach</option><option value="every-run">After every run</option></select></label><label className="field"><span>Report</span><select value={attachReport ? 'yes' : 'no'} onChange={(event) => setAttachReport(event.target.value === 'yes')}><option value="yes">Attach Excel report</option><option value="no">Summary only</option></select></label><label className="field"><span>AI explanation</span><select value={aiSummary ? 'yes' : 'no'} onChange={(event) => setAiSummary(event.target.value === 'yes')}><option value="no">No</option><option value="yes">Yes, when configured</option></select></label></div></section>
        <section className="monitor-section"><h3>Schedule</h3><div className="monitor-grid four"><label className="field"><span>Cadence</span><select value={cadence} onChange={(event) => setCadence(event.target.value as ScheduleCadence)}>{['Weekly', 'Monthly', 'Quarterly', 'Yearly'].map((item) => <option key={item}>{item}</option>)}</select></label>{cadence === 'Weekly' ? <label className="field"><span>Weekday</span><select value={weekday} onChange={(event) => setWeekday(event.target.value)}>{['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((item) => <option key={item}>{item}</option>)}</select></label> : <label className="field"><span>Day</span><input type="number" min="1" max="28" value={dayOfMonth} onChange={(event) => setDayOfMonth(Number(event.target.value))} /></label>}{cadence === 'Yearly' && <label className="field"><span>Month</span><select value={month} onChange={(event) => setMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Date(2026, index, 1).toLocaleString('en', { month: 'short' })}</option>)}</select></label>}<label className="field"><span>Hour UTC</span><input type="number" min="0" max="23" value={hourUtc} onChange={(event) => setHourUtc(Number(event.target.value))} /></label><label className="field"><span>Minute</span><input type="number" min="0" max="59" value={minute} onChange={(event) => setMinute(Number(event.target.value))} /></label></div></section>
        <section className="monitor-section"><h3>Thresholds</h3><div className="monitor-grid three"><label className="field"><span>Min overall quality %</span><input type="number" min="0" max="100" value={minimumOverallQuality} onChange={(event) => setMinimumOverallQuality(event.target.value)} /></label><label className="field"><span>Min strict compliance %</span><input type="number" min="0" max="100" value={minimumRecordCompliance} onChange={(event) => setMinimumRecordCompliance(event.target.value)} placeholder="Optional" /></label><label className="field"><span>Max missing cells %</span><input type="number" min="0" max="100" value={maximumMissingPercent} onChange={(event) => setMaximumMissingPercent(event.target.value)} /></label><label className="field"><span>Max duplicate rows</span><input type="number" min="0" value={maximumDuplicateRows} onChange={(event) => setMaximumDuplicateRows(event.target.value)} /></label><label className="field"><span>Max row-count change %</span><input type="number" min="0" value={maximumRowChangePercent} onChange={(event) => setMaximumRowChangePercent(event.target.value)} /></label><label className="field"><span>Max hours since run</span><input type="number" min="0" value={maximumFreshnessHours} onChange={(event) => setMaximumFreshnessHours(event.target.value)} placeholder="Optional" /></label></div></section>
      </div>
      {error && <div className="alert error monitor-error">{error}</div>}
      <div className="modal-actions monitor-actions"><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button><button type="button" className="primary-button" onClick={save}>Save monitor</button></div>
    </div>
  </div>;
}
