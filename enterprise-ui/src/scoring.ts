import type { QualitySummary } from './types';

export function recordComplianceScore(quality: QualitySummary): number {
  return quality.recordComplianceScore ?? (quality.evaluatedRecords ? (quality.passingRecords / quality.evaluatedRecords) * 100 : 100);
}

export function scoringDescription(quality: QualitySummary): string {
  return quality.scoringMethod === 'weighted-rule-average'
    ? 'Weighted average of active rule scores and contributing dimension weights.'
    : 'Legacy strict record pass rate from a run created before configurable scoring.';
}
