import { useState } from 'react';
import { Database, Plus, RefreshCw, Search } from 'lucide-react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { AdvancedProfileTable, CorrelationMatrix } from '../AdvancedProfileSections';
import { AssetTable, DimensionBars, EmptyState, IssueTable, MetricCard, PageHeader, RunList } from '../components';
import { recordComplianceScore } from '../scoring';
import type { ProfileRun, WorkspaceSnapshot } from '../types';
import { formatDate } from '../utils';

export function AssetsPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const [query, setQuery] = useState('');
  const filtered = { ...workspace, datasets: workspace.datasets.filter((dataset) => `${dataset.name} ${dataset.owner} ${dataset.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())) };
  return <>
    <PageHeader title="Data assets" description="Each asset keeps its profile, DQ evaluations, issues, rules, and history together." actions={<Link className="primary-button" to="/profile"><Plus size={17} /> Add asset</Link>} />
    <div className="toolbar"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" /></label><div className="toolbar-summary">{filtered.datasets.length} asset{filtered.datasets.length === 1 ? '' : 's'}</div></div>
    {filtered.datasets.length ? <AssetTable workspace={filtered} /> : <EmptyState title="No matching assets" body="Try another search, or profile a new dataset." />}
  </>;
}

export function AssetDetailPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const { datasetId } = useParams();
  const dataset = workspace.datasets.find((item) => item.id === datasetId);
  const runs = workspace.runs.filter((run) => run.datasetId === datasetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = runs[0];
  const issues = workspace.issues.filter((issue) => issue.datasetId === datasetId);
  const [tab, setTab] = useState('Overview');
  if (!dataset) return <Navigate to="/assets" replace />;
  const strictScore = latest ? recordComplianceScore(latest.quality) : 0;
  return <>
    <PageHeader backTo="/assets" eyebrow="Data asset" title={dataset.name} description={dataset.description || 'No description added.'} actions={<Link className="primary-button" to={`/profile?dataset=${dataset.id}`}><RefreshCw size={16} /> Run profile</Link>} />
    <div className="asset-meta"><span><b>Owner</b> {dataset.owner || 'Not assigned'}</span><span><b>Updated</b> {formatDate(dataset.updatedAt)}</span><span><b>Tags</b> {dataset.tags.join(', ') || 'None'}</span></div>
    <div className="tabs">{['Overview', 'Profile', 'Advanced profile', 'Correlation', 'Data quality', 'Observability', 'History'].map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {!latest ? <EmptyState title="No profile yet" body="Run the first profile to populate this asset." /> : <>
      {tab === 'Overview' && <div className="dashboard-grid"><section className="panel wide"><div className="metric-grid four embedded"><MetricCard label="Rows" value={latest.rowCount.toLocaleString()} /><MetricCard label="Columns" value={String(latest.columnCount)} /><MetricCard label="Overall quality" value={`${latest.quality.overallScore.toFixed(1)}%`} detail="Weighted rules and dimensions" /><MetricCard label="Memory" value={latest.memoryUsageMB === undefined ? '—' : `${latest.memoryUsageMB.toFixed(2)} MB`} detail="Approximate profiled values" /></div><div className="panel-heading"><div><h2>Quality dimensions</h2><p>Weighted rule pass rates for contributing dimensions</p></div></div><DimensionBars dimensions={latest.quality.dimensions} /></section><section className="panel"><div className="panel-heading"><div><h2>Latest run</h2><p>{formatDate(latest.createdAt)}</p></div></div><dl className="detail-list"><div><dt>File</dt><dd>{latest.fileName}</dd></div><div><dt>Missing cells</dt><dd>{latest.missingCells.toLocaleString()}</dd></div><div><dt>Duplicate rows</dt><dd>{latest.duplicateRows.toLocaleString()}</dd></div><div><dt>Numeric columns</dt><dd>{latest.numericColumnCount ?? 'Not captured'}</dd></div><div><dt>Rules evaluated</dt><dd>{latest.quality.rulesEvaluated}</dd></div><div><dt>Strict compliance</dt><dd>{strictScore.toFixed(1)}%</dd></div></dl><Link className="secondary-button full" to={`/runs/${latest.id}`}>Open full report</Link></section></div>}
      {tab === 'Profile' && <ColumnProfileTable run={latest} />}
      {tab === 'Advanced profile' && <AdvancedProfileTable run={latest} />}
      {tab === 'Correlation' && <CorrelationMatrix run={latest} />}
      {tab === 'Data quality' && <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Overall quality</h2><p>Weighted average of active rules and dimension weights.</p></div></div><div className="hero-score"><strong>{latest.quality.overallScore.toFixed(1)}%</strong><span>Strict record compliance: {strictScore.toFixed(1)}%</span></div></section><section className="panel"><div className="panel-heading"><div><h2>Dimension results</h2><p>A low dimension score contributes according to its configured weight.</p></div></div><DimensionBars dimensions={latest.quality.dimensions} /></section></div>}
      {tab === 'Observability' && <IssueTable issues={issues} />}
      {tab === 'History' && <RunList runs={runs} />}
    </>}
  </>;
}

export function ColumnProfileTable({ run }: { run: ProfileRun }) {
  const [selected, setSelected] = useState(run.columns[0]?.name ?? '');
  const column = run.columns.find((item) => item.name === selected) ?? run.columns[0];
  return <div className="profile-layout"><div className="table-wrap profile-table"><table><thead><tr><th>Column</th><th>Type</th><th>Class</th><th>Missing</th><th>Distinct</th><th>Unique</th><th>Outliers</th></tr></thead><tbody>{run.columns.map((item) => <tr key={item.name} className={selected === item.name ? 'selected' : ''} onClick={() => setSelected(item.name)}><td><strong>{item.name}</strong>{item.likelyKey && <span className="mini-chip">Likely key</span>}</td><td>{item.inferredType}</td><td>{item.classification ?? '—'}</td><td>{item.missingPercentage.toFixed(1)}%</td><td>{item.distinctCount.toLocaleString()}</td><td>{item.uniquenessPercentage.toFixed(1)}%</td><td>{item.outlierCount}</td></tr>)}</tbody></table></div>
    {column && <aside className="profile-inspector"><div className="inspector-heading"><div><span>Column profile</span><h3>{column.name}</h3></div><span className="type-chip">{column.inferredType}</span></div><div className="inspector-metrics"><div><span>Not null</span><strong>{column.nonNullCount.toLocaleString()}</strong></div><div><span>Null</span><strong>{column.missingCount.toLocaleString()}</strong></div><div><span>Distinct</span><strong>{column.distinctCount.toLocaleString()}</strong></div><div><span>Cardinality</span><strong>{((column.cardinalityRatio ?? 0) * 100).toFixed(1)}%</strong></div></div>{column.numericStats && <div className="inspector-section"><h4>Numerical statistics</h4><dl className="detail-list compact"><div><dt>Minimum</dt><dd>{column.numericStats.min.toLocaleString()}</dd></div><div><dt>Maximum</dt><dd>{column.numericStats.max.toLocaleString()}</dd></div><div><dt>Mean</dt><dd>{column.numericStats.mean.toFixed(2)}</dd></div><div><dt>Median</dt><dd>{column.numericStats.median.toFixed(2)}</dd></div><div><dt>Q1 / Q3</dt><dd>{column.numericStats.q1.toFixed(2)} / {column.numericStats.q3.toFixed(2)}</dd></div><div><dt>Std deviation</dt><dd>{column.numericStats.standardDeviation.toFixed(2)}</dd></div><div><dt>Skewness</dt><dd>{column.numericStats.skewness?.toFixed(3) ?? '—'}</dd></div><div><dt>Kurtosis</dt><dd>{column.numericStats.kurtosis?.toFixed(3) ?? '—'}</dd></div></dl></div>}{column.textStats && <div className="inspector-section"><h4>Text length</h4><dl className="detail-list compact"><div><dt>Minimum</dt><dd>{column.textStats.minLength}</dd></div><div><dt>Maximum</dt><dd>{column.textStats.maxLength}</dd></div><div><dt>Average</dt><dd>{column.textStats.meanLength.toFixed(1)}</dd></div></dl></div>}{column.dateStats && <div className="inspector-section"><h4>Date range</h4><dl className="detail-list compact"><div><dt>Earliest</dt><dd>{column.dateStats.min?.slice(0, 10)}</dd></div><div><dt>Latest</dt><dd>{column.dateStats.max?.slice(0, 10)}</dd></div><div><dt>Range</dt><dd>{column.dateStats.rangeDays?.toFixed(1)} days</dd></div></dl></div>}<div className="inspector-section"><h4>Top values</h4>{column.topValues.length ? column.topValues.map((value) => <div className="value-bar" key={value.value}><div><span>{value.value}</span><b>{value.percentage.toFixed(1)}%</b></div><div><i style={{ width: `${value.percentage}%` }} /></div></div>) : <p className="muted">No repeated values to display.</p>}</div>{column.patterns.length > 0 && <div className="inspector-section"><h4>Patterns</h4>{column.patterns.slice(0, 4).map((pattern) => <div className="pattern-row" key={pattern.pattern}><code>{pattern.pattern}</code><span>{pattern.percentage.toFixed(1)}%</span></div>)}</div>}</aside>}
  </div>;
}
