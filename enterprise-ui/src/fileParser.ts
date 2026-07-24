import * as XLSX from 'xlsx';
import { parseFile as parseCsvOrXlsx, type DataRow } from './profiler';

function normalizeHeaders(headers: unknown[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const raw = String(header ?? '').trim() || `unnamed_${index + 1}`;
    const count = (counts.get(raw) ?? 0) + 1;
    counts.set(raw, count);
    return count === 1 ? raw : `${raw}__${count}`;
  });
}

export async function parseBrowserFile(file: File): Promise<{ rows: DataRow[]; sourceKind: 'CSV' | 'Excel' }> {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv' || extension === 'txt') return parseCsvOrXlsx(file);
  if (extension !== 'xlsx' && extension !== 'xls') return parseCsvOrXlsx(file);

  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) throw new Error('The workbook does not contain a worksheet.');
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], { header: 1, raw: true, defval: null, blankrows: false });
  if (!matrix.length) throw new Error('The workbook does not contain any rows.');
  const headers = normalizeHeaders(matrix[0]);
  const rows: DataRow[] = matrix.slice(1).map((values) => {
    const row: DataRow = {};
    headers.forEach((header, index) => { row[header] = values[index] ?? null; });
    return row;
  });
  return { rows, sourceKind: 'Excel' };
}
