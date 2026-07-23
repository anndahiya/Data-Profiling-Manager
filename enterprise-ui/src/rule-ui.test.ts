import { describe, expect, it } from 'vitest';
import type { QualityRule } from './types';

it('supports governed rule weights thresholds and severity', () => {
  const rule: QualityRule = {
    id: 'rule-1', datasetId: 'asset-1', name: 'Amount range', dimension: 'Accuracy', columnName: 'amount',
    ruleType: 'range', expectedValue: '0', secondaryValue: '100', enabled: true, source: 'User',
    weight: 2, threshold: 98.5, severity: 'High', createdAt: '2026-01-01',
  };
  expect(rule.weight).toBe(2);
  expect(rule.threshold).toBe(98.5);
  expect(rule.severity).toBe('High');
});
