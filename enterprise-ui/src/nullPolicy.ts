export const DEFAULT_NULL_TOKENS = ['null', 'n/a', 'nan', '(blank)'] as const;

export function normalizeNullTokens(tokens?: readonly string[]): string[] {
  const source = tokens?.length ? tokens : DEFAULT_NULL_TOKENS;
  return [...new Set(source.map((token) => token.trim().toLowerCase()).filter(Boolean))].sort();
}

export function isNullLike(value: unknown, tokens?: readonly string[]): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'number' && Number.isNaN(value)) return true;
  if (typeof value !== 'string') return false;
  const text = value.trim().toLowerCase();
  return text === '' || normalizeNullTokens(tokens).includes(text);
}

export function parseNullTokenInput(value: string): string[] {
  return normalizeNullTokens(value.split(',').map((token) => token.trim()));
}

export function formatNullTokens(tokens?: readonly string[]): string {
  return normalizeNullTokens(tokens).join(', ');
}
