import { describe, expect, it } from 'vitest';
import { fileMatchesPattern, selectDirectoryCandidate, wildcardToRegExp } from './sources';
import type { BrowserFileHandle, DirectoryCandidate } from './sources';

function candidate(name: string, lastModified: number): DirectoryCandidate {
  const file = { name, lastModified } as File;
  const handle = { kind: 'file', name, getFile: async () => file } as BrowserFileHandle;
  return { file, handle };
}

describe('linked folder source selection', () => {
  it('supports wildcard filename patterns', () => {
    expect(wildcardToRegExp('customer_v?.csv').test('customer_v2.csv')).toBe(true);
    expect(fileMatchesPattern('customer_2026.xlsx', 'customer_*')).toBe(true);
    expect(fileMatchesPattern('notes.pdf', '*')).toBe(false);
  });

  it('chooses the most recently modified matching file', () => {
    const selected = selectDirectoryCandidate([
      candidate('customer_v1.csv', 100),
      candidate('customer_v2.csv', 300),
      candidate('customer_v3.csv', 200),
    ], 'latest-modified');
    expect(selected?.file.name).toBe('customer_v2.csv');
  });

  it('chooses the highest numeric filename version', () => {
    const selected = selectDirectoryCandidate([
      candidate('customer_v2.csv', 300),
      candidate('customer_v10.csv', 100),
      candidate('customer_v3.csv', 200),
    ], 'highest-filename');
    expect(selected?.file.name).toBe('customer_v10.csv');
  });
});
