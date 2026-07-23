import type { DatasetSource, LinkedSourceHandle } from './types';

const SUPPORTED_EXTENSIONS = ['.csv', '.txt', '.xlsx'];

export interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

export interface BrowserFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

export interface BrowserDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<BrowserFileHandle | BrowserDirectoryHandle>;
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{ description?: string; accept: Record<string, string[]> }>;
      excludeAcceptAllOption?: boolean;
      id?: string;
      startIn?: BrowserFileHandle | BrowserDirectoryHandle | string;
    }) => Promise<BrowserFileHandle[]>;
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: BrowserFileHandle | BrowserDirectoryHandle | string;
    }) => Promise<BrowserDirectoryHandle>;
  }
}

export function supportsPersistentFileAccess(): boolean {
  return typeof window !== 'undefined' && Boolean(window.showOpenFilePicker && window.showDirectoryPicker);
}

export function isSupportedDataFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function wildcardToRegExp(pattern: string): RegExp {
  const normalized = pattern.trim() || '*';
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
}

export function fileMatchesPattern(name: string, pattern: string): boolean {
  return isSupportedDataFile(name) && wildcardToRegExp(pattern).test(name);
}

export async function ensureReadPermission(handle: BrowserFileHandle | BrowserDirectoryHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  const current = await handle.queryPermission({ mode: 'read' });
  if (current === 'granted') return true;
  if (current === 'denied' || !handle.requestPermission) return false;
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

export async function pickLinkedFile(): Promise<BrowserFileHandle> {
  if (!window.showOpenFilePicker) throw new Error('Persistent file linking is not supported in this browser. Use Chrome or Edge, or upload the file manually.');
  const [handle] = await window.showOpenFilePicker({
    id: 'dpm-linked-file',
    multiple: false,
    excludeAcceptAllOption: true,
    types: [{
      description: 'Data files',
      accept: {
        'text/csv': ['.csv', '.txt'],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      },
    }],
  });
  if (!handle) throw new Error('No file was selected.');
  return handle;
}

export async function pickLinkedDirectory(): Promise<BrowserDirectoryHandle> {
  if (!window.showDirectoryPicker) throw new Error('Persistent folder linking is not supported in this browser. Use Chrome or Edge, or upload the file manually.');
  return window.showDirectoryPicker({ id: 'dpm-linked-folder', mode: 'read' });
}

export interface DirectoryCandidate {
  handle: BrowserFileHandle;
  file: File;
}

export function selectDirectoryCandidate(
  candidates: DirectoryCandidate[],
  strategy: NonNullable<DatasetSource['selectionStrategy']>,
): DirectoryCandidate | undefined {
  if (!candidates.length) return undefined;
  const sorted = [...candidates];
  if (strategy === 'highest-filename') {
    sorted.sort((a, b) => b.file.name.localeCompare(a.file.name, undefined, { numeric: true, sensitivity: 'base' }));
  } else {
    sorted.sort((a, b) => b.file.lastModified - a.file.lastModified || b.file.name.localeCompare(a.file.name, undefined, { numeric: true }));
  }
  return sorted[0];
}

export async function resolveLinkedSource(
  source: DatasetSource,
  stored: LinkedSourceHandle,
): Promise<{ file: File; sourceLabel: string }> {
  if (!(await ensureReadPermission(stored.handle))) {
    throw new Error('Permission to the linked source is required again. Click Run and approve browser access.');
  }
  if (stored.kind === 'file') {
    const file = await stored.handle.getFile();
    if (!isSupportedDataFile(file.name)) throw new Error('The linked file is no longer a supported CSV, TXT, or XLSX file.');
    return { file, sourceLabel: file.name };
  }

  const pattern = source.filePattern?.trim() || '*';
  const candidates: DirectoryCandidate[] = [];
  for await (const entry of stored.handle.values()) {
    if (entry.kind !== 'file' || !fileMatchesPattern(entry.name, pattern)) continue;
    candidates.push({ handle: entry, file: await entry.getFile() });
  }
  const selected = selectDirectoryCandidate(candidates, source.selectionStrategy ?? 'latest-modified');
  if (!selected) throw new Error(`No supported file in “${stored.handle.name}” matches ${pattern}.`);
  return { file: selected.file, sourceLabel: `${stored.handle.name}/${selected.file.name}` };
}
