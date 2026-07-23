import { describe, expect, it } from 'vitest';
import { buildSuggestedRules, createDefaultDimensions } from './quality';
import type { ColumnProfile } from './types';

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
});