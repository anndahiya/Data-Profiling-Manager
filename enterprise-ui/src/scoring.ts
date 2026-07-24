import type { QualitySummary } from './types';

export function hasGovernedQuality(quality: QualitySummary): boolean {
  if (quality.evaluationStatus === 'not-evaluated') return false;
  return quality.rulesEvaluated > 0;
}

export function recordComplianceScore(quality: QualitySummary): number {
  if (!hasGovernedQuality(quality)) return 0;
  return quality.recordComplianceScore ?? (quality.evaluatedRecords ? (quality.passingRecords / quality.evaluatedRecords) * 100 : 100);
}

export function scoringDescription(quality: QualitySummary): string {
  if (!hasGovernedQuality(quality)) return 'No governed data quality score was calculated because no applicable active rules were evaluated.';
  return quality.scoringMethod === 'weighted-rule-average'
    ? 'Weighted average of active governed rule scores and contributing dimension weights.'
    : 'Legacy strict record pass rate from a run created before configurable scoring.';
}