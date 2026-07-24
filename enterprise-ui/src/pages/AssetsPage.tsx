import { useEffect, useRef, useState } from 'react';
import { Database, Download, Pencil, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { AccessibleTabs, TabPanel } from '../AccessibleTabs';
import { AdvancedProfileTable, CorrelationMatrix } from '../AdvancedProfileSections';
import { assetCascadeCounts, buildAssetBackup, deleteAssetCascade } from '../assetLifecycle';
import { AssetTable, DimensionBars, EmptyState, IssueTable, MetricCard, PageHeader, RunList } from '../components';
import { db } from '../db';
import { hasGovernedQuality, recordComplianceScore } from '../scoring';
import type { Dataset, ProfileRun, WorkspaceSnapshot } from '../types';
import { formatDate } from '../utils';

export function AssetsPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const [query, setQuery] = useState('');
  const filtered = { ...workspace, datasets: workspace.datasets.filter((dataset) => `${dataset.name} ${dataset.owner} ${dataset.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())) };
  return <>
    <PageHeader title="Data assets" description="Each asset keeps its profile, governed DQ evaluations, issues, rules, and history together." actions={<Link className="primary-button" to="/profile"><Plus size={17} /> Add asset</Link>} />
    <div className="toolbar"><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" aria-label="Search data assets" /></label><div className="toolbar-summary" aria-live="polite">{filtered.datasets.length} asset{filtered.datasets.length === 1 ? '' : 's'}</div></div>
    {filtered.datasets.length ? <AssetTable workspace={filtered} /> : <EmptyState title="No matching assets" body="Try another search, or profile a new dataset." />}
  </>;
}

export function AssetDetailPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const { datasetId } = useParams();
  const navigate = useNavigate();
  const dataset = workspace.datasets.find((item) => item.id === datasetId);
  const runs = workspace.runs.filter((run) => run.datasetId === datasetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = runs[0];
  const issues = workspace.issues.filter((issue) => issue.datasetId === datasetId);
  const [tab, setTab] = useState('Overview');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!dataset) return <Navigate to="/assets" replace />;
  const governed = latest ? hasGovernedQuality(latest.quality) : false;
  const strictScore = latest ? recordComplianceScore(latest.quality) : 0;
  const tabs = ['Overview', 'Profile', 'Advanced profile', 'Correlation', 'Data quality', 'Observability', 'History'];
  const counts = assetCascadeCounts(workspace, dataset.id);

  const saveAsset = async (updated: Dataset) => {
    await db.datasets.put(updated);
    setEditing(false);
    await reload();
  };
  const downloadBackup = () => {
    const backup = buildAssetBackup(workspace, dataset.id);
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `${dataset.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'data-asset'}-backup.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const deleteAsset = async () => {
    await deleteAssetCascade(dataset.id);
    await reload();
    navigate('/assets');
  };

  return <>
    <PageHeader backTo="/assets" eyebrow="Data asset" title={dataset.name} description={dataset.description || 'No description added.'} actions={<div className="button-row asset-header-actions"><button className="secondary-button" onClick={() => setEditing(true)}><Pencil size={16} /> Edit</button><button className="secondary-button" onClick={downloadBackup}><Download size={16} /> Backup</button><button className="danger-button" onClick={() => setDeleting(true)}><Trash2 size={16} /> Delete</button><Link className="primary-button" to={`/profile?dataset=${dataset.id}`}><RefreshCw size={16} /> Run profile</Link></div>} />
    <div className="asset-meta"><span><b>Owner</b> {dataset.owner || 'Not assigned'}</span><span><b>Updated</b> {formatDate(dataset.updatedAt)}</span><span><b>Tags</b> {dataset.tags.join(', ') || 'None'}</span></div>
    <AccessibleTabs items={tabs} value={tab} onChange={setTab} label={`${dataset.name} sections`} idPrefix="asset-detail" />
    {!latest ? <EmptyState title="No profile yet" body="Run the first profile to populate this asset." /> : <>
      <TabPanel tab="Overview" active={tab} idPrefix="asset-detail"><div className="dashboard-grid"><section className="panel wide"><div className="metric-grid four embedded"><MetricCard label="Rows" value={latest.rowCount.toLocaleString()} /><MetricCard label="Columns" value={String(latest.columnCount)} /><MetricCard label="Overall quality" value={governed ? `${latest.quality.overallScore.toFixed(1)}%` : 'N/A'} detail={governed ? 'Weighted governed rules and dimensions' : 'No governed evaluation'} /><MetricCard label="Estimated data size" value={latest.memoryUsageMB === undefined ? '—' : `${latest.memoryUsageMB.toFixed(2)} MB`} detail="Serialized profiled values" /></div><div className="panel-heading"><div><h2>Quality dimensions</h2><p>{governed ? 'Weighted rule pass rates for contributing dimensions' : 'No official DQ dimensions were evaluated'}</p></div></div>{governed ? <DimensionBars dimensions={latest.quality.dimensions} /> : <p className="muted">Add governed rules and rerun the profile to calculate an official DQ score.</p>}</section><section className="panel"><div className="panel-heading"><div><h2>Latest run</h2><p>{formatDate(latest.createdAt)}</p></div></div><dl className="detail-list"><div><dt>File</dt><dd>{latest.fileName}</dd></div><div><dt>Missing cells</dt><dd>{latest.missingCells.toLocaleString()}</dd></div><div><dt>Duplicate rows</dt><dd>{latest.duplicateRows.toLocaleString()}</dd></div><div><dt>Numeric columns</dt><dd>{latest.numericColumnCount ?? 'Not captured'}</dd></div><div><dt>Rules evaluated</dt><dd>{latest.quality.rulesEvaluated}</dd></div><div><dt>Records passing all rules</dt><dd>{governed ? `${strictScore.toFixed(1)}%` : 'N/A'}</dd></div></dl><Link className="secondary-button full" to={`/runs/${latest.id}`}>Open full report</Link></section></div></TabPanel>
      <TabPanel tab="Profile" active={tab} idPrefix="asset-detail"><ColumnProfileTable run={latest} /></TabPanel>
      <TabPanel tab="Advanced profile" active={tab} idPrefix="asset-detail"><AdvancedProfileTable run={latest} /></TabPanel>
      <TabPanel tab="Correlation" active={tab} idPrefix="asset-detail"><CorrelationMatrix run={latest} /></TabPanel>
      <TabPanel tab="Data quality" active={tab} idPrefix="asset-detail"><div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Overall quality</h2><p>Weighted average of active governed rules and dimension weights.</p></div></div><div className="hero-score"><strong>{governed ? `${latest.quality.overallScore.toFixed(1)}%` : 'N/A'}</strong><span>{governed ? `Records passing all active rules: ${strictScore.toFixed(1)}%` : 'No official DQ evaluation was performed.'}</span></div></section><section className="panel"><div className="panel-heading"><div><h2>Dimension results</h2><p>A low dimension score contributes according to its configured weight.</p></div></div>{governed ? <DimensionBars dimensions={latest.quality.dimensions} /> : <p className="muted">No applicable governed rules were evaluated.</p>}</section></div></TabPanel>
      <TabPanel tab="Observability" active={tab} idPrefix="asset-detail"><IssueTable issues={issues} /></TabPanel>
      <TabPanel tab="History" active={tab} idPrefix="asset-detail"><RunList runs={runs} /></TabPanel>
    </>}
    {editing && <EditAssetDialog dataset={dataset} onCancel={() => setEditing(false)} onSave={(updated) => void saveAsset(updated)} />}
    {deleting && <DeleteAssetDialog dataset={dataset} counts={counts} onCancel={() => setDeleting(false)} onBackup={downloadBackup} onDelete={() => void deleteAsset()} />}
  </>;
}

function EditAssetDialog({ dataset, onCancel, onSave }: { dataset: Dataset; onCancel: () => void; onSave: (dataset: Dataset) => void }) {
  const [name, setName] = useState(dataset.name);
  const [owner, setOwner] = useState(dataset.owner);
  const [description, setDescription] = useState(dataset.description);
  const [tags, setTags] = useState(dataset.tags.join(', '));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const submit = () => {
    if (!name.trim()) return;
    onSave({ ...dataset, name: name.trim(), owner: owner.trim(), description: description.trim(), tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean), updatedAt: new Date().toISOString() });
  };
  return <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-asset-title"><button className="modal-close" aria-label="Close edit asset dialog" onClick={onCancel}><X size={18} /></button><h2 id="edit-asset-title">Edit data asset</h2><p>Update the business metadata used throughout the workspace. Profiling history and source links are not changed.</p><div className="field-grid"><label className="field"><span>Asset name</span><input ref={inputRef} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Owner / steward</span><input value={owner} onChange={(event) => setOwner(event.target.value)} /></label></div><label className="field"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="field"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="customer, critical, production" /><small>Separate tags with commas.</small></label><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={!name.trim()} onClick={submit}>Save asset</button></div></div></div>;
}

function DeleteAssetDialog({ dataset, counts, onCancel, onBackup, onDelete }: { dataset: Dataset; counts: ReturnType<typeof assetCascadeCounts>; onCancel: () => void; onBackup: () => void; onDelete: () => void }) {
  const [confirmation, setConfirmation] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const confirmed = confirmation === dataset.name;
  return <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-asset-title"><button className="modal-close" aria-label="Close delete asset dialog" onClick={onCancel}><X size={18} /></button><div className="modal-icon danger"><Trash2 size={22} /></div><h2 id="delete-asset-title">Delete “{dataset.name}”?</h2><p>This permanently removes the asset and its related browser data:</p><div className="schema-summary delete-summary"><div><strong>{counts.runs}</strong><span>Runs</span></div><div><strong>{counts.issues}</strong><span>Issues</span></div><div><strong>{counts.rules}</strong><span>Rules</span></div><div><strong>{counts.monitors}</strong><span>Monitors</span></div><div><strong>{counts.connections}</strong><span>Connections</span></div></div><button className="secondary-button" onClick={onBackup}><Download size={16} /> Download asset backup first</button><label className="field delete-confirm-field"><span>Type the asset name to confirm</span><input ref={inputRef} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="danger-button" disabled={!confirmed} onClick={onDelete}>Delete asset and related data</button></div></div></div>;
}

export function ColumnProfileTable({ run }: { run: ProfileRun }) {
  const [selected, setSelected] = useState(run.columns[0]?.name ?? '');
  const column = run.columns.find((item) => item.name === selected) ?? run.columns[0];
  return <div className="profile-layout"><div className="table-wrap profile-table"><table><thead><tr><th>Column</th><th>Type</th><th>Class</th><th>Missing</th><th>Distinct</th><th>Unique</th><th>Outliers</th></tr></thead><tbody>{run.columns.map((item) => <tr key={item.name} className={selected === item.name ? 'selected' : ''} aria-selected={selected === item.name} tabIndex={0} onClick={() => setSelected(item.name)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(item.name); } }}><td><strong>{item.name}</strong>{item.likelyKey && <span className="mini-chip">Likely key</span>}</td><td>{item.inferredType}</td><td>{item.classification ?? '—'}</td><td>{item.missingPercentage.toFixed(1)}%</td><td>{item.distinctCount.toLocaleString()}</td><td>{item.uniquenessPercentage.toFixed(1)}%</td><td>{item.outlierCount}</td></tr>)}</tbody></table></div>
    {column && <aside className="profile-inspector" aria-live="polite"><div className="inspector-heading"><div><span>Column profile</span><h3>{column.name}</h3></div><span className="type-chip">{column.inferredType}</span></div><div className="inspector-metrics"><div><span>Not null</span><strong>{column.nonNullCount.toLocaleString()}</strong></div><div><span>Null</span><strong>{column.missingCount.toLocaleString()}</strong></div><div><span>Distinct</span><strong>{column.distinctCount.toLocaleString()}</strong></div><div><span>Cardinality</span><strong>{((column.cardinalityRatio ?? 0) * 100).toFixed(1)}%</strong></div></div>{column.numericStats && <div className="inspector-section"><h4>Numerical statistics</h4><dl className="detail-list compact"><div><dt>Minimum</dt><dd>{column.numericStats.min.toLocaleString()}</dd></div><div><dt>Maximum</dt><dd>{column.numericStats.max.toLocaleString()}</dd></div><div><dt>Mean</dt><dd>{column.numericStats.mean.toFixed(2)}</dd></div><div><dt>Median</dt><dd>{column.numericStats.median.toFixed(2)}</dd></div><div><dt>Q1 / Q3</dt><dd>{column.numericStats.q1.toFixed(2)} / {column.numericStats.q3.toFixed(2)}</dd></div><div><dt>Std deviation</dt><dd>{column.numericStats.standardDeviation.toFixed(2)}</dd></div><div><dt>Skewness</dt><dd>{column.numericStats.skewness?.toFixed(3) ?? '—'}</dd></div><div><dt>Kurtosis</dt><dd>{column.numericStats.kurtosis?.toFixed(3) ?? '—'}</dd></div></dl></div>}{column.textStats && <div className="inspector-section"><h4>Text length</h4><dl className="detail-list compact"><div><dt>Minimum</dt><dd>{column.textStats.minLength}</dd></div><div><dt>Maximum</dt><dd>{column.textStats.maxLength}</dd></div><div><dt>Average</dt><dd>{column.textStats.meanLength.toFixed(1)}</dd></div></dl></div>}{column.dateStats && <div className="inspector-section"><h4>Date range</h4><dl className="detail-list compact"><div><dt>Earliest</dt><dd>{column.dateStats.min?.slice(0, 10)}</dd></div><div><dt>Latest</dt><dd>{column.dateStats.max?.slice(0, 10)}</dd></div><div><dt>Range</dt><dd>{column.dateStats.rangeDays?.toFixed(1)} days</dd></div></dl></div>}<div className="inspector-section"><h4>Top values</h4>{column.topValues.length ? column.topValues.map((value) => <div className="value-bar" key={value.value}><div><span>{value.value}</span><b>{value.percentage.toFixed(1)}%</b></div><div><i style={{ width: `${value.percentage}%` }} /></div></div>) : <p className="muted">Raw source values were not retained in this browser profile.</p>}</div>{column.patterns.length > 0 && <div className="inspector-section"><h4>Patterns</h4>{column.patterns.slice(0, 4).map((pattern) => <div className="pattern-row" key={pattern.pattern}><code>{pattern.pattern}</code><span>{pattern.percentage.toFixed(1)}%</span></div>)}</div>}</aside>}
  </div>;
}
