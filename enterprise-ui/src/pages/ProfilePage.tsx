import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, ShieldCheck, Sparkles, UploadCloud } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components';
import { db } from '../db';
import { compareSchema, createIssues, parseFile, profileRows } from '../profiler';
import type { Dataset, ProfileRun, SchemaDiff, WorkspaceSnapshot } from '../types';
import { latestRunFor } from '../utils';

export function ProfilePage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const params = new URLSearchParams(useLocation().search);
  const presetDataset = params.get('dataset') ?? '';
  const [datasetId, setDatasetId] = useState(presetDataset || 'new');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ run: ProfileRun; diff: SchemaDiff; existing?: Dataset } | null>(null);
  const selectedDataset = workspace.datasets.find((dataset) => dataset.id === datasetId);

  useEffect(() => {
    if (selectedDataset) { setName(selectedDataset.name); setOwner(selectedDataset.owner); setDescription(selectedDataset.description); }
    else if (datasetId === 'new') { setName(''); setOwner(''); setDescription(''); }
  }, [datasetId, selectedDataset]);

  const commitRun = async (run: ProfileRun, dataset: Dataset) => {
    const previous = latestRunFor(dataset.id, workspace.runs);
    const issues = createIssues(dataset, run, previous).map((issue) => issue.metric === 'Timeliness' ? {
      ...issue,
      category: 'Freshness' as const,
      title: 'Freshness baseline failed',
      description: `${issue.description} The browser baseline treats values older than 30 days as stale until a governed freshness policy is configured.`,
    } : issue);
    await db.transaction('rw', db.datasets, db.runs, db.issues, async () => {
      await db.datasets.put({ ...dataset, latestRunId: run.id, updatedAt: run.createdAt });
      await db.runs.put(run);
      if (issues.length) await db.issues.bulkPut(issues);
    });
    await reload();
    navigate(`/runs/${run.id}`);
  };

  const handleProfile = async () => {
    if (!file || !name.trim()) return;
    setProcessing(true); setError('');
    try {
      const { rows, sourceKind } = await parseFile(file);
      const targetId = selectedDataset?.id ?? crypto.randomUUID();
      const run = profileRows(rows, targetId, file.name, sourceKind);
      const previous = selectedDataset ? latestRunFor(selectedDataset.id, workspace.runs) : undefined;
      const diff = compareSchema(previous, run.columns);
      if (selectedDataset && diff.hasChanges) setPending({ run, diff, existing: selectedDataset });
      else {
        const now = new Date().toISOString();
        await commitRun(run, selectedDataset ?? { id: targetId, name: name.trim(), owner: owner.trim(), description: description.trim(), tags: [], createdAt: now, updatedAt: now });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Profiling failed.');
    } finally { setProcessing(false); }
  };

  const saveAsNew = async () => {
    if (!pending) return;
    const now = new Date().toISOString();
    const newId = crypto.randomUUID();
    const newRun = { ...pending.run, id: crypto.randomUUID(), datasetId: newId };
    await commitRun(newRun, { id: newId, name: `${name.trim()} — ${file?.name.replace(/\.[^.]+$/, '') || 'new schema'}`, owner: owner.trim(), description: description.trim(), tags: ['Schema variant'], createdAt: now, updatedAt: now });
    setPending(null);
  };

  return <>
    <PageHeader title="Profile data" description="Upload a file, inspect the inferred schema, and save the run to a new or existing data asset." />
    {error && <div className="alert error"><AlertTriangle size={17} />{error}</div>}
    <div className="wizard-grid">
      <section className="panel form-panel"><div className="step-label"><span>1</span> Select destination</div><label className="field"><span>Data asset</span><select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}><option value="new">Create a new asset</option>{workspace.datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</select></label><div className="field-grid"><label className="field"><span>Asset name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer master" /></label><label className="field"><span>Owner</span><input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Customer Data Office" /></label></div><label className="field"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this dataset contains and where it is used" /></label></section>
      <section className="panel form-panel"><div className="step-label"><span>2</span> Choose file</div><label className={`dropzone ${file ? 'has-file' : ''}`}><input type="file" accept=".csv,.txt,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><UploadCloud size={28} /><strong>{file ? file.name : 'Drop a CSV or .xlsx file here'}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ready to profile` : 'Your file is processed in this browser. It is not uploaded to our server.'}</span></label><div className="privacy-note"><ShieldCheck size={17} /><div><strong>Private by default</strong><span>Only aggregate profiles, DQ results, and issues are stored in IndexedDB.</span></div></div></section>
    </div>
    <div className="sticky-action"><div><strong>Ready to profile?</strong><span>The system will infer datatypes, profile columns, evaluate starter rules, and check for schema changes.</span></div><button className="primary-button" disabled={!file || !name.trim() || processing} onClick={() => void handleProfile()}>{processing ? <RefreshCw className="spin" size={17} /> : <Sparkles size={17} />} {processing ? 'Profiling…' : 'Run profile & DQ evaluation'}</button></div>
    {pending && <SchemaDialog diff={pending.diff} onCancel={() => setPending(null)} onContinue={() => void commitRun(pending.run, pending.existing!)} onSaveNew={() => void saveAsNew()} />}
  </>;
}

function SchemaDialog({ diff, onCancel, onContinue, onSaveNew }: { diff: SchemaDiff; onCancel: () => void; onContinue: () => void; onSaveNew: () => void }) {
  return <div className="modal-backdrop"><div className="modal-card"><div className="modal-icon warning"><AlertTriangle size={23} /></div><h2>This file does not match the saved schema</h2><p>The run may be intentional for schema-change analysis, or it may have been assigned to the wrong asset. Review the differences before continuing.</p><div className="schema-summary"><div><strong>{diff.added.length}</strong><span>Added columns</span></div><div><strong>{diff.removed.length}</strong><span>Removed columns</span></div><div><strong>{diff.changed.length}</strong><span>Datatype changes</span></div></div><div className="schema-diff-list">{diff.added.map((item) => <div key={`a-${item}`}><span className="diff-icon added">+</span><b>{item}</b><em>Added</em></div>)}{diff.removed.map((item) => <div key={`r-${item}`}><span className="diff-icon removed">−</span><b>{item}</b><em>Removed</em></div>)}{diff.changed.map((item) => <div key={`c-${item.name}`}><span className="diff-icon changed">↔</span><b>{item.name}</b><em>{item.before} → {item.after}</em></div>)}</div><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="secondary-button" onClick={onSaveNew}>Save as a new asset</button><button className="primary-button" onClick={onContinue}>Continue and record schema change</button></div></div></div>;
}
