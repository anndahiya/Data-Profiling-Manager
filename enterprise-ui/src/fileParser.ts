import Papa from 'papaparse';
import { readSheet } from 'read-excel-file/browser';
import type { DataRow } from './profiler';

export const MAX_BROWSER_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_BROWSER_ROWS = 250_000;
export const MAX_BROWSER_COLUMNS = 250;

function normalizeHeaders(headers: unknown[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const raw = String(header ?? '').trim() || `unnamed_${index + 1}`;
    const count = (counts.get(raw) ?? 0) + 1;
    counts.set(raw, count);
    return count === 1 ? raw : `${raw}__${count}`;
  });
}

async function parseCsv(file: File): Promise<DataRow[]> {
  const text = await file.text();
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      transformHeader: (header, index) => header.trim() || `unnamed_${index + 1}`,
      complete: ({ data, errors, meta }) => {
        const fatal = errors.find((error) => error.type === 'Delimiter' || error.type === 'Quotes');
        if (fatal) return reject(new Error(`CSV parsing failed: ${fatal.message}`));
        const fields = normalizeHeaders(meta.fields ?? []);
        const sourceFields = meta.fields ?? [];
        resolve(data.map((row) => {
          const output: DataRow = {};
          fields.forEach((field, index) => { output[field] = row[sourceFields[index] ?? field]; });
          return output;
        }));
      },
      error: (error: Error) => reject(error),
    });
  });
}

async function parseXlsx(file: File): Promise<DataRow[]> {
  const sheet = await readSheet(file);
  if (!sheet.length) throw new Error('The workbook does not contain any rows.');
  const headers = normalizeHeaders(sheet[0]);
  return sheet.slice(1).map((values) => {
    const row: DataRow = {};
    headers.forEach((header, index) => { row[header] = values[index] ?? null; });
    return row;
  });
}

export async function parseBrowserFile(file: File): Promise<{ rows: DataRow[]; sourceKind: 'CSV' | 'Excel' }> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['csv', 'txt', 'xlsx'].includes(extension ?? '')) {
    throw new Error('This browser edition supports CSV, TXT, and .xlsx files. Use the local Python edition for .xls and Parquet.');
  }
  if (file.size > MAX_BROWSER_FILE_BYTES) {
    throw new Error(`This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The browser limit is ${MAX_BROWSER_FILE_BYTES / 1024 / 1024} MB; use the local edition for larger sources.`);
  }
  const rows = extension === 'xlsx' ? await parseXlsx(file) : await parseCsv(file);
  if (rows.length > MAX_BROWSER_ROWS) {
    throw new Error(`This source contains ${rows.length.toLocaleString()} rows. The browser limit is ${MAX_BROWSER_ROWS.toLocaleString()}; use the local edition or a bounded database query.`);
  }
  const columns = rows.length ? Object.keys(rows[0]).length : 0;
  if (columns > MAX_BROWSER_COLUMNS) {
    throw new Error(`This source contains ${columns.toLocaleString()} columns. The browser limit is ${MAX_BROWSER_COLUMNS.toLocaleString()}; reduce the selected fields or use the local edition.`);
  }
  return { rows, sourceKind: extension === 'xlsx' ? 'Excel' : 'CSV' };
}