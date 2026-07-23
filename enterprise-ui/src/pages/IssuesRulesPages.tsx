import { useMemo, useState } from 'react';
import { Pencil, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { IssueTable, PageHeader } from '../components';
import { db } from '../db';
import { buildSuggestedRules, createDefaultDimensions } from '../quality';
import type { Issue, IssueStatus, ProfileRun, QualityDimension, QualityRule, RuleSeverity, RuleType, WorkspaceSnapshot } from '../types';
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

const RULE_LABELS: Record<RuleType, string> = {
  'not-null': 'Required value',
  unique: 'Unique value',
  type: 'Expected datatype',
  pattern: 'Pattern / regular expression',
  freshness: 'Fresh within N days',
  range: 'Numeric range',
  'allowed-values': 'Allowed values',
  'min-length': 'Minimum length',
  'max-length': 'Maximum length',
};

export function RulesPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const dimensions = workspace.dimensions?.length ? workspace.dimensions : createDefaultDimensions();
  const [datasetFilter, setDatasetFilter] = useState(workspace.datasets[0]?.id ?? 'All');
  const [editingRule, setEditingRule] = useState<QualityRule | 'new' | null>(null);
  const [editingDimension, setEditingDimension] = useState<QualityDimension | 'new' | null>(null);
  const rules = workspace.rules
    .filter((rule) => datasetFilter === 'All' || rule.datasetId === datasetFilter)
    .sort((a, b) => a.dimension.localeCompare(b.dimension) || a.name.localeCompare(b.name));

  const latestRuns = workspace.datasets.map((dataset) => latestRunFor(dataset.id, workspace.runs)).filter(Boolean) as ProfileRun[];
  const suggestions = useMemo(() => latestRuns.flatMap((run) => buildSuggestedRules(run.datasetId, run.columns)).filter((suggestion) => {
    if (datasetFilter !== 'All' && suggestion.datasetId !== datasetFilter) return false;
    return !workspace.rules.some((rule) => rule.datasetId === suggestion.datasetId && rule.columnName === suggestion.columnName && rule.ruleType === suggestion.ruleType && rule.dimension.toLowerCase() === suggestion.dimension.toLowerCase());
  }).slice(0, 30), [datasetFilter, latestRuns, workspace.rules]);

  const saveRule = async (rule: QualityRule) => { await db.rules.put(rule); setEditingRule(null); await reload(); };
  const toggleRule = async (rule: QualityRule) => { await db.rules.update(rule.id, { enabled: !rule.enabled, updatedAt: new Date().toISOString() }); await reload(); };
  const deleteRule = async (rule: QualityRule) => {
    if (!window.confirm(`Delete “${rule.name}”? This affects future runs only.`)) return;
    await db.rules.delete(rule.id); await reload();
  };
  const addSuggestion = async (suggestion: QualityRule) => {
    await db.rules.put({ ...suggestion, id: crypto.randomUUID(), source: 'Suggested', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await reload();
  };
  const saveDimension = async (dimension: QualityDimension) => { await db.dimensions.put(dimension); setEditingDimension(null); await reload(); };
  const toggleDimension = async (dimension: QualityDimension) => { await db.dimensions.update(dimension.id, { enabled: !dimension.enabled, updatedAt: new Date().toISOString() }); await reload(); };
  const deleteDimension = async (dimension: QualityDimension) => {
    if (dimension.source !== 'User') return;
    if (workspace.rules.some((rule) => rule.dimension.toLowerCase() === dimension.name.toLowerCase())) { window.alert('Move or delete the rules assigned to this dimension first.'); return; }
    if (!window.confirm(`Delete the custom dimension “${dimension.name}”?`)) return;
    await db.dimensions.delete(dimension.id); await reload();
  };

  return <>
    <PageHeader title="Rules & dimensions" description="Define what quality means for each asset. Overall quality is a weighted average of rule scores and dimension weights; strict record compliance remains visible separately." actions={<div className="button-row"><button className="secondary-button" onClick={() => setEditingDimension('new')}><Plus size={16} /> Add dimension</button><button className="primary-button" disabled={!workspace.datasets.length} onClick={() => setEditingRule('new')}><Plus size={16} /> Add rule</button></div>} />

    <section className="panel" style={{ marginBottom: 16 }}><div className="panel-heading"><div><h2>Quality dimensions</h2><p>The six enabled standards are a starting point. Enable library dimensions, change their weights, or add dimensions used by your organisation.</p></div></div><div className="dimension-card-grid">{dimensions.map((dimension, index) => <div className="dimension-card" key={dimension.id} style={{ opacity: dimension.enabled ? 1 : .62 }}><div className="dimension-icon" style={{ background: `${CHART_COLORS[index % CHART_COLORS.length]}18`, color: CHART_COLORS[index % CHART_COLORS.length] }}><ShieldCheck size={19} /></div><div style={{ flex: 1 }}><h3>{dimension.name}</h3><p>{dimension.description}</p><p><b>Weight:</b> {dimension.weight} · {dimension.source}</p></div><div className="stack-actions"><button className="small-button" onClick={() => void toggleDimension(dimension)}>{dimension.enabled ? 'Enabled' : 'Enable'}</button><button className="icon-button" aria-label={`Edit ${dimension.name}`} onClick={() => setEditingDimension(dimension)}><Pencil size={14} /></button>{dimension.source === 'User' && <button className="icon-button" aria-label={`Delete ${dimension.name}`} onClick={() => void deleteDimension(dimension)}><Trash2 size={14} /></button>}</div></div>)}</div></section>

    <div className="toolbar"><label className="field" style={{ minWidth: 280 }}><span>Rules for data asset</span><select value={datasetFilter} onChange={(event) => setDatasetFilter(event.target.value)}><option value="All">All data assets</option>{workspace.datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><div className="toolbar-summary">{rules.length} governed rule{rules.length === 1 ? '' : 's'}</div></div>

    <section className="panel" style={{ marginBottom: 16 }}><div className="panel-heading"><div><h2>Governed rules</h2><p>Rule weight affects its dimension score. The threshold controls when the rule creates an issue. Changes apply on the next profiling run.</p></div></div>{rules.length ? <div className="table-wrap"><table><thead><tr><th>Rule</th><th>Asset</th><th>Column</th><th>Dimension</th><th>Type</th><th>Weight</th><th>Threshold</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rules.map((rule) => <tr key={rule.id}><td><strong>{rule.name}</strong><span className="cell-subtitle">{rule.source}</span></td><td>{workspace.datasets.find((dataset) => dataset.id === rule.datasetId)?.name ?? 'Unknown asset'}</td><td><code>{rule.columnName}</code></td><td><span className="category-chip">{rule.dimension}</span></td><td>{RULE_LABELS[rule.ruleType]}</td><td>{rule.weight ?? 1}</td><td>{(rule.threshold ?? 95).toFixed(0)}%</td><td><button className="small-button" onClick={() => void toggleRule(rule)}>{rule.enabled ? 'Enabled' : 'Disabled'}</button></td><td><div className="button-row"><button className="icon-button" aria-label="Edit rule" onClick={() => setEditingRule(rule)}><Pencil size={14} /></button><button className="icon-button" aria-label="Delete rule" onClick={() => void deleteRule(rule)}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div> : <div className="mini-empty large">No governed rules yet. Add one manually or promote a profiling suggestion below.</div>}</section>

    <section className="panel"><div className="panel-heading"><div><h2>Profiling-based suggestions</h2><p>These are derived from observed population, datatype, likely-key, dominant-pattern, and freshness characteristics. Review them before promotion.</p></div></div>{suggestions.length ? <div className="table-wrap"><table><thead><tr><th>Asset</th><th>Suggested rule</th><th>Column</th><th>Dimension</th><th>Threshold</th><th></th></tr></thead><tbody>{suggestions.map((suggestion) => <tr key={suggestion.id}><td>{workspace.datasets.find((dataset) => dataset.id === suggestion.datasetId)?.name}</td><td><strong>{suggestion.name}</strong></td><td><code>{suggestion.columnName}</code></td><td><span className="category-chip">{suggestion.dimension}</span></td><td>{suggestion.threshold}%</td><td><button className="small-button" onClick={() => void addSuggestion(suggestion)}>Add rule</button></td></tr>)}</tbody></table></div> : <div className="mini-empty large">No new suggestions. Profile an asset or review the rules already promoted.</div>}</section>

    {editingRule && <RuleEditor value={editingRule === 'new' ? undefined : editingRule} workspace={workspace} dimensions={dimensions.filter((dimension) => dimension.enabled)} initialDatasetId={datasetFilter === 'All' ? workspace.datasets[0]?.id : datasetFilter} onCancel={() => setEditingRule(null)} onSave={(rule) => void saveRule(rule)} />}
    {editingDimension && <DimensionEditor value={editingDimension === 'new' ? undefined : editingDimension} onCancel={() => setEditingDimension(null)} onSave={(dimension) => void saveDimension(dimension)} />}
  </>;
}

function RuleEditor({ value, workspace, dimensions, initialDatasetId, onCancel, onSave }: { value?: QualityRule; workspace: WorkspaceSnapshot; dimensions: QualityDimension[]; initialDatasetId?: string; onCancel: () => void; onSave: (rule: QualityRule) => void }) {
  const now = new Date().toISOString();
  const [datasetId, setDatasetId] = useState(value?.datasetId ?? initialDatasetId ?? workspace.datasets[0]?.id ?? '');
  const latest = latestRunFor(datasetId, workspace.runs);
  const [name, setName] = useState(value?.name ?? '');
  const [columnName, setColumnName] = useState(value?.columnName ?? latest?.columns[0]?.name ?? '');
  const [dimension, setDimension] = useState(value?.dimension ?? dimensions[0]?.name ?? 'Completeness');
  const [ruleType, setRuleType] = useState<RuleType>(value?.ruleType ?? 'not-null');
  const [expectedValue, setExpectedValue] = useState(value?.expectedValue ?? '');
  const [secondaryValue, setSecondaryValue] = useState(value?.secondaryValue ?? '');
  const [weight, setWeight] = useState(value?.weight ?? 1);
  const [threshold, setThreshold] = useState(value?.threshold ?? 95);
  const [severity, setSeverity] = useState<RuleSeverity>(value?.severity ?? 'Medium');
  const columns = latest?.columns ?? [];
  const requiresExpected = !['not-null', 'unique'].includes(ruleType);
  const submit = () => {
    if (!datasetId || !name.trim() || !columnName || !dimension) return;
    onSave({ id: value?.id ?? crypto.randomUUID(), datasetId, name: name.trim(), columnName, dimension, ruleType, expectedValue: requiresExpected ? expectedValue.trim() : undefined, secondaryValue: ruleType === 'range' ? secondaryValue.trim() : undefined, enabled: value?.enabled ?? true, source: value?.source ?? 'User', weight: Math.max(0, Number(weight) || 0), threshold: Math.min(100, Math.max(0, Number(threshold) || 0)), severity, createdAt: value?.createdAt ?? now, updatedAt: now });
  };
  return <div className="modal-backdrop"><div className="modal-card"><button className="modal-close" onClick={onCancel}><X size={18} /></button><h2>{value ? 'Edit quality rule' : 'Add quality rule'}</h2><p>Rules evaluate records during the next profiling run. The rule threshold determines when an issue is opened.</p><div className="field-grid"><label className="field"><span>Data asset</span><select value={datasetId} onChange={(event) => { const next = event.target.value; setDatasetId(next); setColumnName(latestRunFor(next, workspace.runs)?.columns[0]?.name ?? ''); }}><option value="">Choose an asset</option>{workspace.datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><label className="field"><span>Rule name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer ID must be unique" /></label></div><div className="field-grid"><label className="field"><span>Column</span><select value={columnName} onChange={(event) => setColumnName(event.target.value)}><option value="">Choose a profiled column</option>{columns.map((column) => <option key={column.name} value={column.name}>{column.name} · {column.inferredType}</option>)}</select></label><label className="field"><span>Dimension</span><select value={dimension} onChange={(event) => setDimension(event.target.value)}>{dimensions.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label></div><div className="field-grid"><label className="field"><span>Rule type</span><select value={ruleType} onChange={(event) => setRuleType(event.target.value as RuleType)}>{(Object.keys(RULE_LABELS) as RuleType[]).map((type) => <option key={type} value={type}>{RULE_LABELS[type]}</option>)}</select></label>{requiresExpected && <label className="field"><span>{ruleType === 'freshness' ? 'Maximum age in days' : ruleType === 'allowed-values' ? 'Allowed values, comma-separated' : ruleType === 'range' ? 'Minimum value' : ruleType === 'type' ? 'Expected datatype' : 'Expected value'}</span>{ruleType === 'type' ? <select value={expectedValue} onChange={(event) => setExpectedValue(event.target.value)}>{['text', 'integer', 'decimal', 'date', 'boolean'].map((type) => <option key={type}>{type}</option>)}</select> : <input value={expectedValue} onChange={(event) => setExpectedValue(event.target.value)} placeholder={ruleType === 'pattern' ? 'AAA-999 or ^[A-Z]{3}-\\d{3}$' : ''} />}</label>}</div>{ruleType === 'range' && <label className="field"><span>Maximum value</span><input value={secondaryValue} onChange={(event) => setSecondaryValue(event.target.value)} /></label>}<div className="field-grid"><label className="field"><span>Rule weight</span><input type="number" min="0" step="0.1" value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></label><label className="field"><span>Issue threshold (%)</span><input type="number" min="0" max="100" step="0.1" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label></div><label className="field"><span>Issue severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value as RuleSeverity)}>{['Critical', 'High', 'Medium', 'Low', 'Info'].map((item) => <option key={item}>{item}</option>)}</select></label><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={!datasetId || !name.trim() || !columnName || !dimension || (requiresExpected && !expectedValue.trim())} onClick={submit}>Save rule</button></div></div></div>;
}

function DimensionEditor({ value, onCancel, onSave }: { value?: QualityDimension; onCancel: () => void; onSave: (dimension: QualityDimension) => void }) {
  const [name, setName] = useState(value?.name ?? '');
  const [description, setDescription] = useState(value?.description ?? '');
  const [weight, setWeight] = useState(value?.weight ?? 1);
  const [enabled, setEnabled] = useState(value?.enabled ?? true);
  const submit = () => {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    onSave({ id: value?.id ?? `custom-${crypto.randomUUID()}`, name: name.trim(), description: description.trim(), weight: Math.max(0, Number(weight) || 0), enabled, source: value?.source ?? 'User', createdAt: value?.createdAt ?? now, updatedAt: now });
  };
  return <div className="modal-backdrop"><div className="modal-card small"><button className="modal-close" onClick={onCancel}><X size={18} /></button><h2>{value ? `Edit ${value.name}` : 'Add a quality dimension'}</h2><p>Create an organisation-specific dimension or change how strongly a dimension contributes to overall quality.</p><label className="field"><span>Name</span><input value={name} disabled={Boolean(value && value.source !== 'User')} onChange={(event) => setName(event.target.value)} placeholder="Referential integrity" /></label><label className="field"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label><div className="field-grid"><label className="field"><span>Overall score weight</span><input type="number" min="0" step="0.1" value={weight} onChange={(event) => setWeight(Number(event.target.value))} /></label><label className="field"><span>Status</span><select value={enabled ? 'enabled' : 'disabled'} onChange={(event) => setEnabled(event.target.value === 'enabled')}><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label></div><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={!name.trim()} onClick={submit}>Save dimension</button></div></div></div>;
}