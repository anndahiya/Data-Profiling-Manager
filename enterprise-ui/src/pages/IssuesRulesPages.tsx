import { useState } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';
import { IssueTable, PageHeader } from '../components';
import { db } from '../db';
import type { Issue, IssueStatus, ProfileRun, WorkspaceSnapshot } from '../types';
import { CHART_COLORS, latestRunFor } from '../utils';

export function IssuesPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const [category, setCategory] = useState('All');
  const [status, setStatus] = useState('Open');
  const filtered = workspace.issues
    .filter((issue) => (category === 'All' || issue.category === category) && (status === 'All' || issue.status === status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const updateStatus = async (issue: Issue, next: IssueStatus) => { await db.issues.update(issue.id, { status: next }); await reload(); };
  return <>
    <PageHeader title="Issues" description="A single queue for DQ failures, schema changes, volume shifts, anomalies, and freshness findings." />
    <div className="issue-summary">{(['Open', 'Acknowledged', 'Resolved', 'Closed'] as IssueStatus[]).map((item) => <button key={item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}><span>{item}</span><strong>{workspace.issues.filter((issue) => issue.status === item).length}</strong></button>)}</div>
    <div className="toolbar"><div className="filter-pills">{['All', 'Data quality', 'Schema change', 'Record volume', 'Anomaly', 'Freshness'].map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><button className="text-button" onClick={() => setStatus('All')}>Show all statuses</button></div>
    <IssueTable issues={filtered} onStatus={(issue, next) => void updateStatus(issue, next)} />
  </>;
}

export function RulesPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const dimensions = ['Completeness', 'Validity', 'Uniqueness', 'Consistency', 'Timeliness'];
  const latestRuns = workspace.datasets.map((dataset) => latestRunFor(dataset.id, workspace.runs)).filter(Boolean) as ProfileRun[];
  const suggestions = latestRuns.flatMap((run) => run.columns.flatMap((column) => {
    const items: Array<{ datasetId: string; column: string; rule: string; dimension: string; reason: string }> = [];
    if (column.missingPercentage <= 2) items.push({ datasetId: run.datasetId, column: column.name, rule: 'Require a value', dimension: 'Completeness', reason: `${(100 - column.missingPercentage).toFixed(1)}% populated` });
    if (column.likelyKey) items.push({ datasetId: run.datasetId, column: column.name, rule: 'Require uniqueness', dimension: 'Uniqueness', reason: `${column.uniquenessPercentage.toFixed(1)}% unique` });
    if ((column.dominantPatternPercentage ?? 0) >= 90) items.push({ datasetId: run.datasetId, column: column.name, rule: `Match pattern ${column.dominantPattern}`, dimension: 'Consistency', reason: `${column.dominantPatternPercentage?.toFixed(1)}% dominant pattern` });
    return items;
  })).slice(0, 20);
  return <>
    <PageHeader title="Rules & dimensions" description="Define what quality means for your data. Profiling suggests rules; you decide what should be promoted into a governed rule." actions={<button className="primary-button" disabled title="Custom rule builder is planned for the next backend phase"><Plus size={16} /> Create rule</button>} />
    <div className="dimension-card-grid">{dimensions.map((dimension, index) => <div className="dimension-card" key={dimension}><div className="dimension-icon" style={{ background: `${CHART_COLORS[index]}18`, color: CHART_COLORS[index] }}><ShieldCheck size={19} /></div><div><h3>{dimension}</h3><p>{dimension === 'Completeness' ? 'Required values are present.' : dimension === 'Validity' ? 'Values conform to expected types and formats.' : dimension === 'Uniqueness' ? 'Keys and identifiers are not duplicated.' : dimension === 'Consistency' ? 'Patterns and representations remain coherent.' : 'Data arrives within the expected timeframe.'}</p></div><span className="contribution-chip">Contributes to overall</span></div>)}</div>
    <section className="panel"><div className="panel-heading"><div><h2>Profiling-based rule suggestions</h2><p>Suggestions use observed null rates, likely keys, and dominant patterns. They are not silently activated as governed business rules.</p></div></div>{suggestions.length ? <div className="table-wrap"><table><thead><tr><th>Asset</th><th>Column</th><th>Suggested rule</th><th>Dimension</th><th>Why suggested</th></tr></thead><tbody>{suggestions.map((suggestion, index) => <tr key={`${suggestion.datasetId}-${suggestion.column}-${index}`}><td>{workspace.datasets.find((dataset) => dataset.id === suggestion.datasetId)?.name}</td><td><strong>{suggestion.column}</strong></td><td>{suggestion.rule}</td><td><span className="category-chip">{suggestion.dimension}</span></td><td>{suggestion.reason}</td></tr>)}</tbody></table></div> : <div className="mini-empty large">Profile a dataset to generate rule suggestions.</div>}</section>
  </>;
}
