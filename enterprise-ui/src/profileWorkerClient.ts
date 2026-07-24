import type { ProfileRun, QualityDimension, QualityRule } from './types';

export interface ProfileWorkerInput {
  file: File;
  datasetId: string;
  sourceKind: ProfileRun['sourceKind'];
  rules: QualityRule[];
  dimensions?: QualityDimension[];
}

export interface ProfileWorkerJob {
  promise: Promise<ProfileRun>;
  cancel: () => void;
}

export function startProfileWorker(input: ProfileWorkerInput, onProgress?: (message: string) => void): ProfileWorkerJob {
  const id = crypto.randomUUID();
  const worker = new Worker(new URL('./profile.worker.ts', import.meta.url), { type: 'module', name: 'data-profile-worker' });
  let settled = false;
  let rejectPromise: (reason?: unknown) => void = () => undefined;

  const cleanup = () => {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  };

  const promise = new Promise<ProfileRun>((resolve, reject) => {
    rejectPromise = reject;
    worker.onmessage = (event: MessageEvent<{ id: string; type: 'progress' | 'complete' | 'error'; message?: string; run?: ProfileRun }>) => {
      if (event.data.id !== id || settled) return;
      if (event.data.type === 'progress') {
        onProgress?.(event.data.message ?? 'Profiling…');
        return;
      }
      settled = true;
      cleanup();
      if (event.data.type === 'complete' && event.data.run) resolve(event.data.run);
      else reject(new Error(event.data.message ?? 'The profile could not be completed.'));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || 'The browser profiling worker stopped unexpectedly.'));
    };
    worker.postMessage({ id, ...input });
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise(new DOMException('Profiling was cancelled.', 'AbortError'));
    },
  };
}
