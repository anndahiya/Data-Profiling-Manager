import { parseFile, type DataRow } from './profiler';

export const MAX_BROWSER_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BROWSER_ROWS = 250_000;
export const MAX_BROWSER_COLUMNS = 250;

export async function parseBrowserFile(file: File): Promise<{ rows: DataRow[]; sourceKind: 'CSV' | 'Excel' }> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['csv', 'txt', 'xlsx'].includes(extension ?? '')) {
    throw new Error('This browser edition supports CSV, TXT, and .xlsx files. Use the local Python edition for .xls and Parquet.');
  }
  if (file.size > MAX_BROWSER_FILE_BYTES) {
    throw new Error(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The browser limit is ${MAX_BROWSER_FILE_BYTES / 1024 / 1024} MB; use the local edition for larger sources.`);
  }
  const parsed = await parseFile(file);
  if (parsed.rows.length > MAX_BROWSER_ROWS) {
    throw new Error(`This source contains ${parsed.rows.length.toLocaleString()} rows. The browser limit is ${MAX_BROWSER_ROWS.toLocaleString()}; use the local edition or a bounded database query.`);
  }
  const columns = parsed.rows.length ? Object.keys(parsed.rows[0]).length : 0;
  if (columns > MAX_BROWSER_COLUMNS) {
    throw new Error(`This source contains ${columns.toLocaleString()} columns. The browser limit is ${MAX_BROWSER_COLUMNS.toLocaleString()}; reduce the selected fields or use the local edition.`);
  }
  return parsed;
}