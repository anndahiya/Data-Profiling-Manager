import { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components';
import { db } from '../db';
import { compareSchema, createIssues, parseFile, profileRows } from '../profiler';
import { SourcePicker } from '../SourcePicker';
import { pickLinkedDirectory, pickLinkedFile, resolveLinkedSource, supportsPersistentFileAccess } from '../sources';
import type { Dataset, DatasetSource, LinkedSourceHandle, ProfileRun, SchemaDiff, SourceMode, WorkspaceSnapshot } from '../types';
import { latestRunFor } from '../utils';

type PendingRun = { run: ProfileRun; diff: SchemaDiff; existing?: Dataset; source: DatasetSource; handle?: LinkedSourceHandle };

export function ProfilePage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const presetDataset = new URLSearchParams(useLocation().search).get('dataset') ?? '';
  const [datasetId, setDatasetId] = useState(presetDataset || 'new');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [description, setDescription] = useState('');
  const [sourceMode, setSourceMode] = useState<SourceMode>('manual-upload');
  const [file, setFile] = useState<File | null>(null);
  const [linkedHandle, setLinkedHandle] = useState<LinkedSourceHandle | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [filePattern, setFilePattern] = useState('*.csv');
  const [selectionStrategy, setSelectionStrategy] = useState<NonNullable<DatasetSource['selectionStrategy']>>('latest-modified');
  const [processing, setProcessing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingRun | null>(null);
  const selectedDataset = workspace.datasets.find((dataset) => dataset.id === datasetId);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setFile(null); setError('');
      if (selectedDataset) {
        setName(selectedDataset.name); setOwner(selectedDataset.owner); setDescription(selectedDataset.description);
        const source = selectedDataset.source ?? { mode: 'manual-upload' as const };
        setSourceMode(source.mode === 'database' ? 'manual-upload' : source.mode);
        setSourceLabel(source.displayName ?? ''); setFilePattern(source.filePattern ?? '*.csv');
        setSelectionStrategy(source.selectionStrategy ?? 'latest-modified');
        const stored = await db.sourceHandles.get(selectedDataset.id);
        if (active) setLinkedHandle(stored ?? null);
      } else {
        setName(''); setOwner(''); setDescription(''); setSourceMode('manual-upload'); setFile(null);
        setLinkedHandle(null); setSourceLabel(''); setFilePattern('*.csv'); setSelectionStrategy('latest-modified');
      }
    };
    void load();
    return () => { active = false; };
  }, [datasetId, selectedDataset]);

  const sourceConfig = (): DatasetSource => ({
    mode: sourceMode,
    displayName: sourceMode === 'manual-upload' ? file?.name : sourceLabel,
    filePattern: sourceMode === 'linked-folder' ? filePattern.trim() || '*' : undefined,
    selectionStrategy: sourceMode === 'linked-folder' ? selectionStrategy : undefined,
  });

  const commitRun = async (run: ProfileRun, dataset: Dataset, handle?: LinkedSourceHandle) => {
    const previous = latestRunFor(dataset.id, workspace.runs);
    const issues = createIssues(dataset, run, previous).map((issue) => issue.metric === 'Timeliness' ? { ...issue, category: 'Freshness' as const, title: 'Freshness baseline failed', description: `${issue.description} The browser baseline treats values older than 30 days as stale until a governed freshness policy is configured.` } : issue);
    await db.transaction('rw', db.datasets, db.runs, db.issues, db.sourceHandles, async () => {
      await db.datasets.put({ ...dataset, latestRunId: run.id, updatedAt: run.createdAt });
      await db.runs.put(run);
      if (issues.length) await db.issues.bulkPut(issues);
      if (handle) await db.sourceHandles.put({ ...handle, datasetId: dataset.id, updatedAt: run.createdAt });
      else if (dataset.source?.mode === 'manual-upload') await db.sourceHandles.delete(dataset.id);
    });
    await reload(); navigate(`/runs/${run.id}`);
  };

  const chooseFile = async () => {
    setLinking(true); setError('');
    try {
      const handle = await pickLinkedFile();
      setLinkedHandle({ datasetId: selectedDataset?.id ?? 'pending', kind: 'file', handle, displayName: handle.name, updatedAt: new Date().toISOString() });
      setSourceLabel(handle.name); setSourceMode('linked-file');
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The file could not be linked.'); }
    finally { setLinking(false); }
  };

  const chooseFolder = async () => {
    setLinking(true); setError('');
    try {
      const handle = await pickLinkedDirectory();
      setLinkedHandle({ datasetId: selectedDataset?.id ?? 'pending', kind: 'directory', handle, displayName: handle.name, updatedAt: new Date().toISOString() });
      setSourceLabel(handle.name); setSourceMode('linked-folder');
    } catch (caught) { if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught instanceof Error ? caught.message : 'The folder could not be linked.'); }
    finally { setLinking(false); }
  };

  const handleProfile = async () => {
    if (!name.trim()) return;
    setProcessing(true); setError('');
    try {
      const targetId = selectedDataset?.id ?? crypto.randomUUID();
      const source = sourceConfig();
      let selectedFile: File; let sourceKind: ProfileRun['sourceKind']; let sourceReference: string; let storedHandle: LinkedSourceHandle | undefined;
      if (sourceMode === 'manual-upload') {
        if (!file) throw new Error('Choose a file to profile.');
        selectedFile = file; sourceReference = file.name; sourceKind = file.name.toLowerCase().endsWith('.xlsx') ? 'Excel' : 'CSV';
      } else {
        if (!linkedHandle) throw new Error('Link a file or folder before running the profile.');
        const resolved = await resolveLinkedSource(source, linkedHandle);
        selectedFile = resolved.file; sourceReference = resolved.sourceLabel;
        sourceKind = sourceMode === 'linked-folder' ? 'Linked folder' : 'Linked file';
        storedHandle = { ...linkedHandle, datasetId: targetId };
      }
      const parsed = await parseFile(selectedFile);
      const run = { ...profileRows(parsed.rows, targetId, selectedFile.name, sourceKind), sourceReference };
      const diff = compareSchema(selectedDataset ? latestRunFor(selectedDataset.id, workspace.runs) : undefined, run.columns);
      if (selectedDataset && diff.hasChanges) setPending({ run, diff, existing: selectedDataset, source, handle: storedHandle });
      else {
        const now = new Date().toISOString();
        const dataset = selectedDataset ? { ...selectedDataset, source } : { id: targetId, name: name.trim(), owner: owner.trim(), description: description.trim(), tags: [], createdAt: now, updatedAt: now, source };
        await commitRun(run, dataset, storedHandle);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Profiling failed.'); }
    finally { setProcessing(false); }
  };

  const saveAsNew = async () => {
    if (!pending) return;
    const now = new Date().toISOString(); const newId = crypto.randomUUID();
    const newRun = { ...pending.run, id: crypto.randomUUID(), datasetId: newId };
    await commitRun(newRun, { id: newId, name: `${name.trim()} — ${newRun.fileName.replace(/\.[^.]+$/, '') || 'new schema'}`, owner: owner.trim(), description: description.trim(), tags: ['Schema variant'], createdAt: now, updatedAt: now, source: pending.source }, pending.handle ? { ...pending.handle, datasetId: newId } : undefined);
    setPending(null);
  };

  const canRun = Boolean(name.trim() && (sourceMode === 'manual-upload' ? file : linkedHandle));
  return <>
    <PageHeader title="Profile data" description="Upload once, link a file, or link a versioned folder so future runs can reuse the same source." />
    {error && <div className="alert error"><AlertTriangle size={17} />{error}</div>}
    <div className="wizard-grid">
      <section className="panel form-panel"><div className="step-label"><span>1</span> Select destination</div><label className="field"><span>Data asset</span><select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}><option value="new">Create a new asset</option>{workspace.datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</select></label><div className="field-grid"><label className="field"><span>Asset name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer master" /></label><label className="field"><span>Owner / steward</span><input value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Customer Data Office" /></label></div><label className="field"><span>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this dataset contains and where it is used" /></label></section>
      <SourcePicker sourceMode={sourceMode} setSourceMode={(value) => { setSourceMode(value); setError(''); }} file={file} setFile={setFile} sourceLabel={sourceLabel} filePattern={filePattern} setFilePattern={setFilePattern} selectionStrategy={selectionStrategy} setSelectionStrategy={setSelectionStrategy} persistentAccessSupported={supportsPersistentFileAccess()} linking={linking} chooseLinkedFile={() => void chooseFile()} chooseLinkedFolder={() => void chooseFolder()} />
    </div>
    <div className="sticky-action"><div><strong>{sourceMode === 'manual-upload' ? 'Ready to profile?' : 'Ready to refresh this asset?'}</strong><span>{sourceMode === 'linked-folder' ? `The app will select the ${selectionStrategy === 'latest-modified' ? 'most recently modified' : 'highest-version'} file matching ${filePattern || '*'}.` : sourceMode === 'linked-file' ? 'The app will read the latest saved contents of the linked file.' : 'The system will infer datatypes, profile columns, evaluate starter rules, and check for schema changes.'}</span></div><button className="primary-button" disabled={!canRun || processing} onClick={() => void handleProfile()}>{processing ? <RefreshCw className="spin" size={17} /> : <Sparkles size={17} />} {processing ? 'Profiling…' : sourceMode === 'manual-upload' ? 'Run profile & DQ evaluation' : 'Run latest from linked source'}</button></div>
    {pending && <SchemaDialog diff={pending.diff} onCancel={() => setPending(null)} onContinue={() => void commitRun(pending.run, { ...pending.existing!, source: pending.source }, pending.handle)} onSaveNew={() => void saveAsNew()} />}
  </>;
}

function SchemaDialog({ diff, onCancel, onContinue, onSaveNew }: { diff: SchemaDiff; onCancel: () => void; onContinue: () => void; onSaveNew: () => void }) {
  return <div className="modal-backdrop"><div className="modal-card"><div className="modal-icon warning"><AlertTriangle size={23} /></div><h2>This file does not match the saved schema</h2><p>The run may be intentional for schema-change analysis, or it may have been assigned to the wrong asset. Review the differences before continuing.</p><div className="schema-summary"><div><strong>{diff.added.length}</strong><span>Added columns</span></div><div><strong>{diff.removed.length}</strong><span>Removed columns</span></div><div><strong>{diff.changed.length}</strong><span>Datatype changes</span></div></div><div className="schema-diff-list">{diff.added.map((item) => <div key={`a-${item}`}><span className="diff-icon added">+</span><b>{item}</b><em>Added</em></div>)}{diff.removed.map((item) => <div key={`r-${item}`}><span className="diff-icon removed">−</span><b>{item}</b><em>Removed</em></div>)}{diff.changed.map((item) => <div key={`c-${item.name}`}><span className="diff-icon changed">↔</span><b>{item.name}</b><em>{item.before} → {item.after}</em></div>)}</div><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="secondary-button" onClick={onSaveNew}>Save as a new asset</button><button className="primary-button" onClick={onContinue}>Continue and record schema change</button></div></div></div>;
}
