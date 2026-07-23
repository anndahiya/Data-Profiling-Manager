import { useState } from 'react';
import { FileBarChart } from 'lucide-react';
import { Navigate, useParams } from 'react-router-dom';
import { DimensionBars, IssueTable, MetricCard, PageHeader } from '../components';
import type { WorkspaceSnapshot } from '../types';
import { formatDate } from '../utils';
import { ColumnProfileTable } from './AssetsPage';

export function RunReportPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const { runId } = useParams();
  const run = workspace.runs.find((item) => item.id === runId);
  const dataset = workspace.datasets.find((item) => item.id === run?.datasetId);
  const [tab, setTab] = useState('Summary');
  if (!run || !dataset) return <Navigate to="/history" replace />;
  const issues = workspace.issues.filter((issue) => issue.runId === run.id);
  const download = () => {
    const blob = new Blob([JSON.stringify({ dataset, run, issues }, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${dataset.name.replace(/\W+/g, '_')}_${run.createdAt.slice(0, 10)}_profile.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  return <>
    <PageHeader backTo="/history" eyebrow={`${dataset.name} · Profiling run`} title={run.fileName} description={`${formatDate(run.createdAt)} · ${run.sourceKind}`} actions={<button className="secondary-button" onClick={download}><FileBarChart size={16} /> Download profile</button>} />
    <div className="metric-grid five"><MetricCard label="Rows" value={run.rowCount.toLocaleString()} /><MetricCard label="Columns" value={String(run.columnCount)} /><MetricCard label="Duplicate rows" value={run.duplicateRows.toLocaleString()} /><MetricCard label="Missing cells" value={run.missingCells.toLocaleString()} /><MetricCard label="Overall quality" value={`${run.quality.overallScore.toFixed(1)}%`} /></div>
    <div className="tabs">{['Summary', 'Column profiles', 'Data quality', 'Issues'].map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === 'Summary' && <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Run summary</h2><p>Deterministic profile and rule evaluation</p></div></div><dl className="detail-list"><div><dt>Data asset</dt><dd>{dataset.name}</dd></div><div><dt>Schema fingerprint</dt><dd><code>{run.schemaFingerprint.slice(0, 72)}{run.schemaFingerprint.length > 72 ? '…' : ''}</code></dd></div><div><dt>Rules evaluated</dt><dd>{run.quality.rulesEvaluated}</dd></div><div><dt>Records passing all rules</dt><dd>{run.quality.passingRecords.toLocaleString()}</dd></div><div><dt>Records failing one or more rules</dt><dd>{run.quality.failingRecords.toLocaleString()}</dd></div></dl></section><section className="panel"><div className="panel-heading"><div><h2>Quality dimensions</h2><p>Pass rates by contributing dimension</p></div></div><DimensionBars dimensions={run.quality.dimensions} /></section></div>}
    {tab === 'Column profiles' && <ColumnProfileTable run={run} />}
    {tab === 'Data quality' && <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Overall quality</h2><p>A record passes only if all active contributing rules pass.</p></div></div><div className="hero-score"><strong>{run.quality.overallScore.toFixed(1)}%</strong><span>{run.quality.passingRecords.toLocaleString()} passing · {run.quality.failingRecords.toLocaleString()} failing</span></div></section><section className="panel"><DimensionBars dimensions={run.quality.dimensions} /></section></div>}
    {tab === 'Issues' && <IssueTable issues={issues} />}
  </>;
}
