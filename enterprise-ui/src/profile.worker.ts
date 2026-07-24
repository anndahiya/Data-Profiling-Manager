/// <reference lib="webworker" />

import { enhanceProfileRun } from './advancedProfiler';
import { profileBrowserRows } from './browserProfiler';
import { parseBrowserFile } from './fileParser';
import { evaluateConfiguredQuality } from './quality';
import type { ProfileFailureStage, ProfileRun, QualityDimension, QualityRule } from './types';

interface WorkerRequest {
  id: string;
  file: File;
  datasetId: string;
  sourceKind: ProfileRun['sourceKind'];
  rules: QualityRule[];
  dimensions?: QualityDimension[];
  nullTokens?: string[];
}

type WorkerResponse =
  | { id: string; type: 'progress'; message: string; stage: ProfileFailureStage }
  | { id: string; type: 'complete'; run: ProfileRun }
  | { id: string; type: 'error'; message: string; stage: ProfileFailureStage; errorName?: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const send = (response: WorkerResponse) => scope.postMessage(response);
  let stage: ProfileFailureStage = 'file-validation';
  try {
    send({ id: request.id, type: 'progress', message: 'Reading and validating the source file…', stage });
    stage = 'parsing';
    const parsed = await parseBrowserFile(request.file);
    send({ id: request.id, type: 'progress', message: 'Profiling columns and distributions…', stage: 'profiling' });
    stage = 'profiling';
    const base = profileBrowserRows(parsed.rows, request.datasetId, request.file.name, request.sourceKind, request.nullTokens);
    send({ id: request.id, type: 'progress', message: 'Calculating advanced statistics and correlations…', stage: 'advanced-statistics' });
    stage = 'advanced-statistics';
    const enhanced = enhanceProfileRun(parsed.rows, base, request.nullTokens);
    send({ id: request.id, type: 'progress', message: 'Evaluating governed quality rules…', stage: 'quality-evaluation' });
    stage = 'quality-evaluation';
    const run: ProfileRun = {
      ...enhanced,
      quality: evaluateConfiguredQuality(parsed.rows, enhanced.columns, request.rules, request.dimensions, request.nullTokens),
    };
    send({ id: request.id, type: 'complete', run });
  } catch (caught) {
    send({ id: request.id, type: 'error', stage, message: caught instanceof Error ? caught.message : 'The profile could not be completed.', errorName: caught instanceof Error ? caught.name : undefined });
  }
};

export {};
