/// <reference lib="webworker" />

import { enhanceProfileRun } from './advancedProfiler';
import { profileBrowserRows } from './browserProfiler';
import { parseBrowserFile } from './fileParser';
import { evaluateConfiguredQuality } from './quality';
import type { ProfileRun, QualityDimension, QualityRule } from './types';

interface WorkerRequest {
  id: string;
  file: File;
  datasetId: string;
  sourceKind: ProfileRun['sourceKind'];
  rules: QualityRule[];
  dimensions?: QualityDimension[];
}

type WorkerResponse =
  | { id: string; type: 'progress'; message: string }
  | { id: string; type: 'complete'; run: ProfileRun }
  | { id: string; type: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const send = (response: WorkerResponse) => scope.postMessage(response);
  try {
    send({ id: request.id, type: 'progress', message: 'Reading and validating the source file…' });
    const parsed = await parseBrowserFile(request.file);
    send({ id: request.id, type: 'progress', message: 'Profiling columns and distributions…' });
    const base = profileBrowserRows(parsed.rows, request.datasetId, request.file.name, request.sourceKind);
    send({ id: request.id, type: 'progress', message: 'Calculating advanced statistics and correlations…' });
    const enhanced = enhanceProfileRun(parsed.rows, base);
    send({ id: request.id, type: 'progress', message: 'Evaluating governed quality rules…' });
    const run: ProfileRun = {
      ...enhanced,
      quality: evaluateConfiguredQuality(parsed.rows, enhanced.columns, request.rules, request.dimensions),
    };
    send({ id: request.id, type: 'complete', run });
  } catch (caught) {
    send({ id: request.id, type: 'error', message: caught instanceof Error ? caught.message : 'The profile could not be completed.' });
  }
};

export {};
