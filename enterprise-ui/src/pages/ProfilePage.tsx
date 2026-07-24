import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { PageHeader } from '../components';
import { db } from '../db';
import { reconcileIssueSet } from '../issueLifecycle';
import { DEFAULT_NULL_TOKENS, formatNullTokens, parseNullTokenInput } from '../nullPolicy';
import { compareSchema, createIssues } from '../profiler';
import { createProfileFailure } from '../profileFailures';
import { ProfileWorkerError, startProfileWorker, type ProfileWorkerJob } from '../profileWorkerClient';
import { createQualityIssues } from '../quality';
import { applyRetentionPolicy } from '../retention';
import { SourcePicker } from '../SourcePicker';
import { pickLinkedDirectory, pickLinkedFile, resolveLinkedSource, supportsPersistentFileAccess } from '../sources';
import type { Dataset, DatasetSource, LinkedSourceHandle, ProfileFailureStage, ProfileRun, SchemaDiff, SourceMode, WorkspaceSnapshot } from '../types';
import { latestRunFor } from '../utils';

type PendingRun = { run: ProfileRun; diff: SchemaDiff; existing?: Dataset; source: DatasetSource; handle?: LinkedSourceHandle };

export function ProfilePage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const presetDataset = new URLSearchParams(useLocation().search).get('dataset') ?? '';
  const [datasetId, setDatasetId] = useState(presetDataset || 'new');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [description, setDescription] = useState('');
  const [nullTokenInput, setNullTokenInput] = useState(formatNullTokens(DEFAULT_NULL_TOKENS));
  const [sourceMode, setSourceMode] = useState<SourceMode>('manual-upload');
  const [file, setFile] = useState<File | null>(null);
  const [linkedHandle, setLinkedHandle] = useState<LinkedSourceHandle | null>(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [filePattern, setFilePattern] = useState('*.csv');
  const [selectionStrategy, setSelectionStrategy] = useState<NonNullable<DatasetSource['selectionStrategy']>>('latest-modified');
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState('');
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingRun | null>(null);
  const jobRef = useRef<ProfileWorkerJob | null>(null);
  const selectedDataset = workspace.datasets.find((dataset) => dataset.id === datasetId);

  useEffect(() => () => jobRef.current?.cancel(), []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      setFile(null); setError('');
      if (selectedDataset) {
        setName(selectedDataset.name); setOwner(selectedDataset.owner); setDescription(selectedDataset.description);
        setNullTokenInput(formatNullTokens(selectedDataset.nullTokens));
        const source = selectedDataset.source ?? { mode: 'manual-upload' as const };
        setSourceMode(source.mode === 'database' ? 'manual-upload' : source.mode);
        setSourceLabel(source.displayName ?? ''); setFilePattern(source.filePattern ?? '*.csv');
        setSelectionStrategy(source.selectionStrategy ?? 'latest-modified');
        const stored = await db.sourceHandles.get(selectedDataset.id);
        if (active) setLinkedHandle(stored ?? null);
      } else {
        setName(''); setOwner(''); setDescription(''); setNullTokenInput(formatNullTokens(DEFAULT_NULL_TOKENS)); setSourceMode('manual-upload'); setFile(null);
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
    const observabilityIssues = createIssues(dataset, run, previous).filter((issue) => issue.category !== 'Data quality');
    const qualityIssues = createQualityIssues(dataset.id, run.id, run.createdAt, run.quality).map((issue) => {
      const result = run.quality.ruleResults?.find((item) => item.ruleName === issue.metric);
      return { ...issue, issueKey: `dq:${result?.ruleId ?? issue.metric ?? issue.id}` };
    });
    const generatedIssues = [...observabilityIssues, ...qualityIssues];

    await db.transaction('rw', [db.datasets, db.runs, db.issues, db.sourceHandles], async () => {
      await db.datasets.put({ ...dataset, latestRunId: run.id, updatedAt: run.createdAt });
      await db.runs.put(run);
      const existingIssues = await db.issues.where('datasetId').equals(dataset.id).toArray();
      const plan = reconcileIssueSet(existingIssues, generatedIssues, run.id, run.createdAt, ['Data quality', 'Schema change', 'Record volume', 'Anomaly']);
      if (plan.upserts.length || plan.resolutions.length) await db.issues.bulkPut([...plan.upserts, ...plan.resolutions]);
      if (handle) await db.sourceHandles.put({ ...handle, datasetId: dataset.id, updatedAt: run.createdAt });
      else if (dataset.source?.mode === 'manual-upload') await db.sourceHandles.delete(dataset.id);
    });
    await applyRetentionPolicy(workspace.settings);
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
    const startedAt = new Date().toISOString();
    const targetId = selectedDataset?.id ?? crypto.randomUUID();
    let failureStage: ProfileFailureStage = 'source-selection';
    let selectedSourceName = file?.name ?? sourceLabel;
    setProcessing(true); setProgress('Preparing the profiling worker…'); setError('');
    try {
      const source = sourceConfig();
      const nullTokens = parseNullTokenInput(nullTokenInput);
      let selectedFile: File; let sourceKind: ProfileRun['sourceKind']; let sourceReference: string; let storedHandle: LinkedSourceHandle | undefined;
      if (sourceMode === 'manual-upload') {
        if (!file) throw new Error('Choose a file to profile.');
        selectedFile = file; sourceReference = file.name; sourceKind = /\.xlsx$/i.test(file.name) ? 'Excel' : 'CSV';
      } else {
        if (!linkedHandle) throw new Error('Link a file or folder before running the profile.');
        const resolved = await resolveLinkedSource(source, linkedHandle);
        selectedFile = resolved.file; sourceReference = resolved.sourceLabel;
        sourceKind = sourceMode === 'linked-folder' ? 'Linked folder' : 'Linked file';
        storedHandle = { ...linkedHandle, datasetId: targetId };
      }
      selectedSourceName = sourceReference;
      failureStage = 'file-validation';
      const configuredRules = workspace.rules.filter((rule) => rule.datasetId === targetId);
      const job = startProfileWorker({ file: selectedFile, datasetId: targetId, sourceKind, rules: configuredRules, dimensions: workspace.dimensions, nullTokens }, (status) => { failureStage = status.stage; setProgress(status.message); });
      jobRef.current = job;
      const workerRun = await job.promise;
      jobRef.current = null;
      const run: ProfileRun = { ...workerRun, sourceReference, nullTokens };
      const diff = compareSchema(selectedDataset ? latestRunFor(selectedDataset.id, workspace.runs) : undefined, run.columns);
      if (selectedDataset && diff.hasChanges) setPending({ run, diff, existing: selectedDataset, source, handle: storedHandle });
      else {
        failureStage = 'saving';
        const now = new Date().toISOString();
        const dataset = selectedDataset
          ? { ...selectedDataset, source, nullTokens }
          : { id: targetId, name: name.trim(), owner: owner.trim(), description: description.trim(), tags: [], createdAt: now, updatedAt: now, source, nullTokens };
        await commitRun(run, dataset, storedHandle);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') setError('Profiling was cancelled. No run was saved.');
      else {
        const stage = caught instanceof ProfileWorkerError ? caught.stage : failureStage;
        const failure = createProfileFailure({ datasetId: selectedDataset?.id, assetName: name, sourceName: selectedSourceName, sourceMode, startedAt, stage, error: caught });
        await db.failures.put(failure);
        await applyRetentionPolicy(workspace.settings);
        await reload();
        setError(`${failure.message} The failed attempt was saved in Run history.`);
      }
    } finally {
      jobRef.current = null;
      setProcessing(false);
      setProgress('');
    }
  };

  const cancelProfile = () => jobRef.current?.cancel();
  const saveAsNew = async () => {
    if (!pending) return;
    const now = new Date().toISOString(); const newId = crypto.randomUUID();
    const newRun = { ...pending.run, id: crypto.randomUUID(), datasetId: newId };
    await commitRun(newRun, { id: newId, name: `${name.trim()} — ${newRun.fileName.replace(/\.[^.]+$/, '') || 'new schema'}`, owner: owner.trim(), description: description.trim(), tags: ['Schema variant'], createdAt: now, updatedAt: now, source: pending.source, nullTokens: pending.run.nullTokens }, pending.handle ? { ...pending.handle, datasetId: newId } : undefined);
    setPending(null);
  };

  const canRun = Boolean(name.trim() && (sourceMode === 'manual-upload' ? file : linkedHandle));
  const configuredRuleCount = selectedDataset ? workspace.rules.filter((rule) => rule.datasetId === selectedDataset.id && rule.enabled).length : 0;
  const governedEvaluation = configuredRuleCount > 0;
  return <>
    <PageHeader title="Profile data" description="Upload once, link a file, or link a versioned folder so future runs can reuse the same source." />
    {error && <div className="alert error" role="alert" aria-live="assertive"><AlertTriangle size={17} />{error}</div>}
    {!governedEvaluation && <div className="alert warning"><AlertTriangle size={17} /><span>The data profile will run, but the official DQ score will show N/A until you add and enable governed rules for this asset. Profiling-based suggestions remain recommendations only.</span></div>}
    <div className="wizard-grid">
      <section className="panel form-panel"><div className="step-label"><span>1</span> Select destination</div><label className="field"><span>Data asset</span><select value={datasetId} disabled={processing} onChange={(event) => setDatasetId(event.target.value)}><option value="new">Create a new asset</option>{workspace.datasets.map((dataset) => <option value={dataset.id} key={dataset.id}>{dataset.name}</option>)}</select></label><div className="field-grid"><label className="field"><span>Asset name</span><input value={name} disabled={processing} onChange={(event) => setName(event.target.value)} placeholder="Customer master" /></label><label className="field"><span>Owner / steward</span><input value={owner} disabled={processing} onChange={(event) => setOwner(event.target.value)} placeholder="Customer Data Office" /></label></div><label className="field"><span>Description</span><textarea value={description} disabled={processing} onChange={(event) => setDescription(event.target.value)} placeholder="What this dataset contains and where it is used" /></label><label className="field"><span>Values treated as missing</span><input value={nullTokenInput} disabled={processing} onChange={(event) => setNullTokenInput(event.target.value)} placeholder="null, n/a, nan, (blank)" /><small>Comma-separated and case-insensitive. Empty cells are always missing. This policy is saved with the asset and frozen with each completed run.</small></label></section>
      <SourcePicker sourceMode={sourceMode} setSourceMode={(value) => { if (!processing) { setSourceMode(value); setError(''); } }} file={file} setFile={setFile} sourceLabel={sourceLabel} filePattern={filePattern} setFilePattern={setFilePattern} selectionStrategy={selectionStrategy} setSelectionStrategy={setSelectionStrategy} persistentAccessSupported={supportsPersistentFileAccess()} linking={linking || processing} chooseLinkedFile={() => void chooseFile()} chooseLinkedFolder={() => void chooseFolder()} />
    </div>
    <div className="sticky-action" aria-live="polite"><div><strong>{processing ? 'Profiling in the background' : sourceMode === 'manual-upload' ? 'Ready to profile?' : 'Ready to refresh this asset?'}</strong><span>{processing ? progress : sourceMode === 'linked-folder' ? `The app will select the ${selectionStrategy === 'latest-modified' ? 'most recently modified' : 'highest-version'} file matching ${filePattern || '*'}.` : sourceMode === 'linked-file' ? 'The app will read the latest saved contents of the linked file.' : governedEvaluation ? `${configuredRuleCount} governed rules will be evaluated.` : 'The profile will be saved without an official DQ score.'}</span></div><div className="button-row">{processing && <button className="secondary-button" onClick={cancelProfile}><X size={16} /> Cancel</button>}<button className="primary-button" disabled={!canRun || processing} onClick={() => void handleProfile()}>{processing ? <RefreshCw className="spin" size={17} /> : <Sparkles size={17} />} {processing ? 'Profiling…' : governedEvaluation ? 'Run profile & DQ evaluation' : 'Run profile'}</button></div></div>
    {pending && <SchemaDialog diff={pending.diff} onCancel={() => setPending(null)} onContinue={() => void commitRun(pending.run, { ...pending.existing!, source: pending.source, nullTokens: pending.run.nullTokens }, pending.handle)} onSaveNew={() => void saveAsNew()} />}
  </>;
}

function SchemaDialog({ diff, onCancel, onContinue, onSaveNew }: { diff: SchemaDiff; onCancel: () => void; onContinue: () => void; onSaveNew: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="schema-dialog-title"><div className="modal-icon warning"><AlertTriangle size={23} /></div><h2 id="schema-dialog-title">This file does not match the saved schema</h2><p>The run may be intentional for schema-change analysis, or it may have been assigned to the wrong asset. Review the differences before continuing.</p><div className="schema-summary"><div><strong>{diff.added.length}</strong><span>Added columns</span></div><div><strong>{diff.removed.length}</strong><span>Removed columns</span></div><div><strong>{diff.changed.length}</strong><span>Datatype changes</span></div></div><div className="schema-diff-list">{diff.added.map((item) => <div key={`a-${item}`}><span className="diff-icon added">+</span><b>{item}</b><em>Added</em></div>)}{diff.removed.map((item) => <div key={`r-${item}`}><span className="diff-icon removed">−</span><b>{item}</b><em>Removed</em></div>)}{diff.changed.map((item) => <div key={`c-${item.name}`}><span className="diff-icon changed">↔</span><b>{item.name}</b><em>{item.before} → {item.after}</em></div>)}</div><div className="modal-actions"><button ref={cancelRef} className="ghost-button" onClick={onCancel}>Cancel</button><button className="secondary-button" onClick={onSaveNew}>Save as a new asset</button><button className="primary-button" onClick={onContinue}>Continue and record schema change</button></div></div></div>;
}
