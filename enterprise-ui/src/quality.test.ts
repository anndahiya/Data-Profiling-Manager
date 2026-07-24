import { describe, expect, it } from 'vitest';
import { buildSuggestedRules, createDefaultDimensions, evaluateConfiguredQuality } from './quality';
import type { ColumnProfile, QualityRule } from './types';

function column(overrides: Partial<ColumnProfile>): ColumnProfile {
  return {
    name: 'customer_id', inferredType: 'integer', nonNullCount: 100, missingCount: 0, missingPercentage: 0,
    distinctCount: 100, uniqueCount: 100, duplicateValueCount: 0, uniquenessPercentage: 100, outlierCount: 0,
    likelyKey: true, topValues: [], patterns: [], ...overrides,
  };
}

describe('quality configuration helpers', () => {
  it('ships six enabled standard dimensions and optional library dimensions', () => {
    const dimensions = createDefaultDimensions();
    expect(dimensions.filter((item) => item.enabled).map((item) => item.name)).toEqual([
      'Accuracy', 'Completeness', 'Consistency', 'Timeliness', 'Uniqueness', 'Validity',
    ]);
    expect(dimensions.find((item) => item.name === 'Currency')?.enabled).toBe(false);
  });

  it('suggests uniqueness only for likely identifiers', () => {
    const suggestions = buildSuggestedRules('customer', [
      column({ name: 'customer_id', likelyKey: true }),
      column({ name: 'annual_income', likelyKey: false }),
    ]);
    expect(suggestions.some((item) => item.columnName === 'customer_id' && item.ruleType === 'unique')).toBe(true);
    expect(suggestions.some((item) => item.columnName === 'annual_income' && item.ruleType === 'unique')).toBe(false);
  });

  it('does not turn profiling suggestions into an official DQ score', () => {
    const columns = [column({ name: 'customer_id' })];
    const quality = evaluateConfiguredQuality([{ customer_id: '001' }, { customer_id: '002' }], columns, [], createDefaultDimensions());
    expect(quality.evaluationStatus).toBe('not-evaluated');
    expect(quality.rulesEvaluated).toBe(0);
    expect(quality.overallScore).toBe(0);
    expect(quality.ruleResults).toEqual([]);
  });

  it('retains the exact governed rule definition and configuration fingerprint on the run', () => {
    const columns = [column({ name: 'customer_id' })];
    const rule: QualityRule = {
      id: 'customer-id-required', datasetId: 'customer', name: 'Customer ID is required', dimension: 'Completeness',
      columnName: 'customer_id', ruleType: 'not-null', enabled: true, source: 'User', weight: 2, threshold: 99,
      severity: 'High', createdAt: '2026-01-01',
    };
    const quality = evaluateConfiguredQuality([{ customer_id: '001' }, { customer_id: '' }], columns, [rule], createDefaultDimensions());
    expect(quality.evaluationStatus).toBe('governed');
    expect(quality.overallScore).toBe(50);
    expect(quality.ruleResults?.[0]).toMatchObject({ columnName: 'customer_id', ruleType: 'not-null', threshold: 99, weight: 2 });
    expect(quality.evaluationSnapshot?.rules[0]).toMatchObject(rule);
    expect(quality.configurationFingerprint).toMatch(/^fnv1a-/);
  });

  it('records rules skipped because their source column is missing instead of reporting 100%', () => {
    const rule: QualityRule = {
      id: 'missing-column', datasetId: 'customer', name: 'Missing column is required', dimension: 'Completeness',
      columnName: 'not_in_file', ruleType: 'not-null', enabled: true, source: 'User', createdAt: '2026-01-01',
    };
    const quality = evaluateConfiguredQuality([{ customer_id: '001' }], [column({ name: 'customer_id' })], [rule], createDefaultDimensions());
    expect(quality.evaluationStatus).toBe('not-evaluated');
    expect(quality.skippedRules).toHaveLength(1);
    expect(quality.overallScore).toBe(0);
  });
});