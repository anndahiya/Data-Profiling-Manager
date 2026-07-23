import { expect, it } from 'vitest';
import { scoringDescription } from './scoring';

it('labels weighted scoring distinctly from strict record compliance', () => {
  expect(scoringDescription({ evaluatedRecords: 1, passingRecords: 0, failingRecords: 1, overallScore: 50, dimensions: [], rulesEvaluated: 2, recordComplianceScore: 0, scoringMethod: 'weighted-rule-average' })).toContain('Weighted average');
});
