import type { ProfileFailureStage, ProfileRun, QualityDimension, QualityRule } from './types';

export interface ProfileWorkerInput {
  file: File;
  datasetId: string;
  sourceKind: ProfileRun['sourceKind'];
  rules: QualityRule[];
  dimensions?: QualityDimension[];
  nullTokens?: string[];
}

export interface ProfileWorkerProgress {
  message: string;
  stage: ProfileFailureStage;
}

export class ProfileWorkerError extends Error {
  stage: ProfileFailureStage;
  constructor(message: string, stage: ProfileFailureStage, errorName?: string) {
    super(message);
    this.name = errorName || 'ProfileWorkerError';
    this.stage = stage;
  }
}

export interface ProfileWorkerJob {
  promise: Promise<ProfileRun>;
  cancel: () => void;
}

export function startProfileWorker(input: ProfileWorkerInput, onProgress?: (progress: ProfileWorkerProgress) => void): ProfileWorkerJob {
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
    worker.onmessage = (event: MessageEvent<{ id: string; type: 'progress' | 'complete' | 'error'; message?: string; run?: ProfileRun; stage?: ProfileFailureStage; errorName?: string }>) => {
      if (event.data.id !== id || settled) return;
      if (event.data.type === 'progress') {
        onProgress?.({ message: event.data.message ?? 'Profiling…', stage: event.data.stage ?? 'profiling' });
        return;
      }
      settled = true;
      cleanup();
      if (event.data.type === 'complete' && event.data.run) resolve(event.data.run);
      else reject(new ProfileWorkerError(event.data.message ?? 'The profile could not be completed.', event.data.stage ?? 'profiling', event.data.errorName));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new ProfileWorkerError(event.message || 'The browser profiling worker stopped unexpectedly.', 'profiling', 'WorkerError'));
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
