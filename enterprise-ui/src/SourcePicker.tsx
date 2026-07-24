import { AlertTriangle, File, FolderOpen, Link2, ShieldCheck, UploadCloud } from 'lucide-react';
import type { DatasetSource, SourceMode } from './types';
import './source.css';

export function SourcePicker({
  sourceMode,
  setSourceMode,
  file,
  setFile,
  sourceLabel,
  filePattern,
  setFilePattern,
  selectionStrategy,
  setSelectionStrategy,
  persistentAccessSupported,
  linking,
  chooseLinkedFile,
  chooseLinkedFolder,
}: {
  sourceMode: SourceMode;
  setSourceMode: (value: SourceMode) => void;
  file: File | null;
  setFile: (value: File | null) => void;
  sourceLabel: string;
  filePattern: string;
  setFilePattern: (value: string) => void;
  selectionStrategy: NonNullable<DatasetSource['selectionStrategy']>;
  setSelectionStrategy: (value: NonNullable<DatasetSource['selectionStrategy']>) => void;
  persistentAccessSupported: boolean;
  linking: boolean;
  chooseLinkedFile: () => void;
  chooseLinkedFolder: () => void;
}) {
  return <section className="panel form-panel">
    <div className="step-label"><span>2</span> Choose source behavior</div>
    <label className="field"><span>Source mode</span><select value={sourceMode} onChange={(event) => setSourceMode(event.target.value as SourceMode)}>
      <option value="manual-upload">One-time upload</option>
      <option value="linked-file" disabled={!persistentAccessSupported}>Link the same file</option>
      <option value="linked-folder" disabled={!persistentAccessSupported}>Link a folder of versions</option>
    </select></label>

    {sourceMode === 'manual-upload' && <label className={`dropzone ${file ? 'has-file' : ''}`}>
      <input type="file" accept=".csv,.txt,.xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <UploadCloud size={28} />
      <strong>{file ? file.name : 'Drop a CSV or Excel file here'}</strong>
      <span>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ready to profile` : 'Supports CSV, .xlsx, and legacy .xls. The browser cannot reveal or remember a one-time upload path.'}</span>
    </label>}

    {sourceMode === 'linked-file' && <div className="linked-source-card">
      <File size={24} /><div><strong>{sourceLabel || 'No file linked yet'}</strong><span>Future runs read the current contents of this same file.</span></div>
      <button className="secondary-button" type="button" disabled={linking} onClick={chooseLinkedFile}><Link2 size={16} /> {sourceLabel ? 'Relink file' : 'Choose file'}</button>
    </div>}

    {sourceMode === 'linked-folder' && <>
      <div className="linked-source-card"><FolderOpen size={24} /><div><strong>{sourceLabel || 'No folder linked yet'}</strong><span>The app scans the selected folder every time this asset runs.</span></div><button className="secondary-button" type="button" disabled={linking} onClick={chooseLinkedFolder}><Link2 size={16} /> {sourceLabel ? 'Relink folder' : 'Choose folder'}</button></div>
      <div className="field-grid">
        <label className="field"><span>Filename pattern</span><input value={filePattern} onChange={(event) => setFilePattern(event.target.value)} placeholder="customer_*.csv" /><small>Use * for any characters and ? for one character.</small></label>
        <label className="field"><span>Choose matching file by</span><select value={selectionStrategy} onChange={(event) => setSelectionStrategy(event.target.value as NonNullable<DatasetSource['selectionStrategy']>)}><option value="latest-modified">Most recently modified</option><option value="highest-filename">Highest filename/version</option></select></label>
      </div>
    </>}

    {!persistentAccessSupported && <div className="alert warning"><AlertTriangle size={17} />Linked local sources require Chrome or Edge. Manual upload still works.</div>}
    <div className="privacy-note"><ShieldCheck size={17} /><div><strong>Private by default</strong><span>Raw rows stay in this browser. Linked handles are stored only in this browser's IndexedDB.</span></div></div>
  </section>;
}
