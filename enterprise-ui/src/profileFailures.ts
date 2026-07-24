import type { ProfileFailure, ProfileFailureStage, SourceMode } from './types';

export interface ProfileFailureInput {
  datasetId?: string;
  assetName: string;
  sourceName?: string;
  sourceMode: SourceMode;
  startedAt: string;
  stage: ProfileFailureStage;
  error: unknown;
}

export function createProfileFailure(input: ProfileFailureInput): ProfileFailure {
  const error = input.error instanceof Error ? input.error : new Error(String(input.error || 'Unknown profiling error'));
  return {
    id: crypto.randomUUID(),
    datasetId: input.datasetId,
    assetName: input.assetName.trim() || 'Unnamed asset',
    sourceName: input.sourceName,
    sourceMode: input.sourceMode,
    startedAt: input.startedAt,
    failedAt: new Date().toISOString(),
    stage: input.stage,
    message: error.message.slice(0, 2000),
    errorName: error.name,
  };
}

export function failureStageLabel(stage: ProfileFailureStage): string {
  return ({
    'source-selection': 'Source selection',
    'file-validation': 'File validation',
    parsing: 'File parsing',
    profiling: 'Base profiling',
    'advanced-statistics': 'Advanced statistics',
    'quality-evaluation': 'Quality evaluation',
    saving: 'Saving results',
  } as const)[stage];
}
