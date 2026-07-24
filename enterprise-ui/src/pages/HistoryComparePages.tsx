import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Trash2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Link } from 'react-router';
import { EmptyState, PageHeader, ScoreBadge } from '../components';
import { db } from '../db';
import { compareSchema } from '../profiler';
import type { ProfileRun, WorkspaceSnapshot } from '../types';
import { formatDate } from '../utils';
import { ConfirmDialog } from './SettingsPage';

export function HistoryPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const runs = [...workspace.runs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const deleteSelected = async () => {
    const ids = [...selected];
    const affected = [...new Set(runs.filter((run) => selected.has(run.id)).map((run) => run.datasetId))];
    await db.transaction('rw', db.datasets, db.runs, db.issues, async () => {
      await db.runs.bulkDelete(ids);
      await db.issues.where('runId').anyOf(ids).delete();
      for (const datasetId of affected) {
        const dataset = await db.datasets.get(datasetId);
        if (!dataset) continue;
        const remaining = (await db.runs.where('datasetId').equals(datasetId).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        await db.datasets.update(datasetId, { latestRunId: remaining[0]?.id, updatedAt: remaining[0]?.createdAt ?? dataset.updatedAt });
      }
    });
    setSelected(new Set()); setConfirming(false); await reload();
  };
  return <>
    <PageHeader title="Run history" description="Review, open, compare, export, or delete specific saved profiling runs." actions={selected.size > 0 && <button className="danger-button" onClick={() => setConfirming(true)}><Trash2 size={16} /> Delete selected ({selected.size})</button>} />
    {!runs.length ? <EmptyState title="No profiling history" body="Profile a dataset to create the first saved run." action={<Link className="primary-button" to="/profile">Profile data</Link>} /> : <div className="table-wrap"><table><thead><tr><th className="checkbox-cell"><input aria-label="Select all runs" type="checkbox" checked={selected.size === runs.length && runs.length > 0} onChange={() => setSelected(selected.size === runs.length ? new Set() : new Set(runs.map((run) => run.id)))} /></th><th>Data asset</th><th>Run</th><th>Rows</th><th>Schema</th><th>Quality</th><th>Issues</th><th /></tr></thead><tbody>{runs.map((run) => {
      const dataset = workspace.datasets.find((item) => item.id === run.datasetId);
      const issueCount = workspace.issues.filter((issue) => issue.runId === run.id).length;
      const previous = workspace.runs.filter((item) => item.datasetId === run.datasetId && item.createdAt < run.createdAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const changed = compareSchema(previous, run.columns).hasChanges;
      return <tr key={run.id} className={selected.has(run.id) ? 'selected-row' : ''}><td className="checkbox-cell"><input aria-label={`Select ${run.fileName}`} type="checkbox" checked={selected.has(run.id)} onChange={() => toggle(run.id)} /></td><td><Link to={`/assets/${run.datasetId}`}>{dataset?.name ?? 'Unknown asset'}</Link></td><td><strong>{formatDate(run.createdAt)}</strong><span className="cell-subtitle">{run.fileName}</span></td><td>{run.rowCount.toLocaleString()}</td><td>{changed ? <span className="status-chip warning"><AlertTriangle size={13} /> Changed</span> : <span className="status-chip good"><Check size={13} /> Stable</span>}</td><td><ScoreBadge score={run.quality.overallScore} /></td><td>{issueCount}</td><td><Link className="row-action labeled" to={`/runs/${run.id}`}>Open <ChevronRight size={15} /></Link></td></tr>;
    })}</tbody></table></div>}
    {confirming && <ConfirmDialog title={`Delete ${selected.size} saved run${selected.size === 1 ? '' : 's'}?`} body="Only the checked runs will be deleted. Their generated issues will also be removed. Other runs and datasets remain unchanged." confirmLabel="Delete selected runs" onCancel={() => setConfirming(false)} onConfirm={() => void deleteSelected()} />}
  </>;
}

export function ComparePage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const eligible = workspace.datasets.filter((dataset) => workspace.runs.filter((run) => run.datasetId === dataset.id).length >= 2);
  const [datasetId, setDatasetId] = useState(eligible[0]?.id ?? '');
  const runs = workspace.runs.filter((run) => run.datasetId === datasetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [beforeId, setBeforeId] = useState(runs[1]?.id ?? '');
  const [afterId, setAfterId] = useState(runs[0]?.id ?? '');
  useEffect(() => { setBeforeId(runs[1]?.id ?? ''); setAfterId(runs[0]?.id ?? ''); }, [datasetId, runs.length]);
  const before = runs.find((run) => run.id === beforeId);
  const after = runs.find((run) => run.id === afterId);
  if (!eligible.length) return <><PageHeader title="Compare runs" description="Compare profile, DQ, volume, and schema changes between two runs." /><EmptyState title="Two runs are required" body="Profile the same asset at least twice to unlock comparison." action={<Link className="primary-button" to="/profile">Run another profile</Link>} /></>;
  const schema = before && after ? compareSchema(before, after.columns) : undefined;
  const summaryData = before && after ? [
    { metric: 'Rows', Before: before.rowCount, After: after.rowCount },
    { metric: 'Columns', Before: before.columnCount, After: after.columnCount },
    { metric: 'Missing %', Before: Number(before.missingPercentage.toFixed(1)), After: Number(after.missingPercentage.toFixed(1)) },
    { metric: 'Duplicates', Before: before.duplicateRows, After: after.duplicateRows },
  ] : [];
  const dimensions = before && after ? [...new Set([...before.quality.dimensions.map((item) => item.dimension), ...after.quality.dimensions.map((item) => item.dimension)])].map((dimension) => ({ dimension, Before: before.quality.dimensions.find((item) => item.dimension === dimension)?.score ?? 0, After: after.quality.dimensions.find((item) => item.dimension === dimension)?.score ?? 0 })) : [];
  return <>
    <PageHeader title="Compare runs" description="See profile, DQ, volume, and schema changes side by side." />
    <div className="compare-selectors"><label className="field"><span>Data asset</span><select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{eligible.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><label className="field"><span>Earlier run</span><select value={beforeId} onChange={(event) => setBeforeId(event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>{formatDate(run.createdAt)} · {run.fileName}</option>)}</select></label><label className="field"><span>Later run</span><select value={afterId} onChange={(event) => setAfterId(event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>{formatDate(run.createdAt)} · {run.fileName}</option>)}</select></label></div>
    {before && after && before.id !== after.id && <div className="dashboard-grid"><section className="panel wide"><div className="panel-heading"><div><h2>Profile comparison</h2><p>Absolute values for both selected runs</p></div></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={summaryData}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="metric" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip /><Legend /><Bar dataKey="Before" fill="#a7a9d8" radius={[5, 5, 0, 0]} /><Bar dataKey="After" fill="#5b5bd6" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section><section className="panel"><div className="panel-heading"><div><h2>Schema changes</h2><p>Columns and inferred datatypes</p></div></div>{schema?.hasChanges ? <div className="schema-card-list"><div><span className="diff-icon added">+</span><strong>{schema.added.length}</strong><span>Added</span></div><div><span className="diff-icon removed">−</span><strong>{schema.removed.length}</strong><span>Removed</span></div><div><span className="diff-icon changed">↔</span><strong>{schema.changed.length}</strong><span>Type changes</span></div></div> : <div className="mini-empty"><Check size={22} /><span>Schema is stable</span></div>}<div className="schema-diff-list compact">{schema?.added.map((item) => <div key={item}><span className="diff-icon added">+</span><b>{item}</b><em>Added</em></div>)}{schema?.removed.map((item) => <div key={item}><span className="diff-icon removed">−</span><b>{item}</b><em>Removed</em></div>)}{schema?.changed.map((item) => <div key={item.name}><span className="diff-icon changed">↔</span><b>{item.name}</b><em>{item.before} → {item.after}</em></div>)}</div></section><section className="panel wide"><div className="panel-heading"><div><h2>Quality dimension comparison</h2><p>Pass-rate movement by dimension</p></div></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><BarChart data={dimensions}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="dimension" tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} tickLine={false} axisLine={false} /><Tooltip /><Legend /><Bar dataKey="Before" fill="#a7a9d8" radius={[5, 5, 0, 0]} /><Bar dataKey="After" fill="#5b5bd6" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section></div>}
  </>;
}
