import ExcelJS from 'exceljs';
import { recordComplianceScore } from './scoring';
import type {
  Dataset,
  Issue,
  MonitorPolicy,
  ProfileRun,
  QualityDimension,
  QualityRule,
  RuleResult,
  RuleSeverity,
  RuleType,
} from './types';

const COLORS = {
  navy: 'FF252547',
  purple: 'FF5B5BD6',
  purpleDark: 'FF39358F',
  purpleSoft: 'FFEEEEFF',
  ink: 'FF202235',
  muted: 'FF697086',
  line: 'FFD9DDE8',
  soft: 'FFF6F7FB',
  white: 'FFFFFFFF',
  green: 'FF16856A',
  greenSoft: 'FFE8F7F2',
  amber: 'FFB66A09',
  amberSoft: 'FFFFF4DF',
  red: 'FFC13E52',
  redSoft: 'FFFFF0F2',
  blueSoft: 'FFE9F1FF',
};

const REPORT_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface DataQualityReportContext {
  dataset: Dataset;
  run: ProfileRun;
  issues: Issue[];
  previousRun?: ProfileRun;
  rules?: QualityRule[];
  dimensions?: QualityDimension[];
  monitor?: MonitorPolicy;
}

interface ReportColumn<T> {
  header: string;
  key: keyof T | string;
  width: number;
  numFmt?: string;
}

function safeFileName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'data_asset';
}

function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function applyThinBorder(cell: ExcelJS.Cell): void {
  cell.border = {
    top: { style: 'thin', color: { argb: COLORS.line } },
    left: { style: 'thin', color: { argb: COLORS.line } },
    bottom: { style: 'thin', color: { argb: COLORS.line } },
    right: { style: 'thin', color: { argb: COLORS.line } },
  };
}

function styleWorkbook(workbook: ExcelJS.Workbook): void {
  workbook.creator = 'Data Profiling Manager by Aanchal Dahiya';
  workbook.company = 'Data Profiling Manager';
  workbook.subject = 'Data quality and profiling report';
  workbook.category = 'Data Quality';
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;
}

function configureSheet(sheet: ExcelJS.Worksheet, landscape = true): void {
  sheet.properties.defaultRowHeight = 18;
  sheet.pageSetup = {
    orientation: landscape ? 'landscape' : 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
  sheet.headerFooter.oddFooter = '&LData Profiling Manager&RPage &P of &N';
}

function addReportTitle(
  sheet: ExcelJS.Worksheet,
  title: string,
  subtitle: string,
  endColumn: number,
): number {
  sheet.mergeCells(1, 1, 2, endColumn);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.fill = solidFill(COLORS.navy);
  titleCell.font = { name: 'Aptos Display', size: 20, bold: true, color: { argb: COLORS.white } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 27;
  sheet.getRow(2).height = 14;

  sheet.mergeCells(3, 1, 3, endColumn);
  const subtitleCell = sheet.getCell(3, 1);
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: 'Aptos', size: 10, italic: true, color: { argb: COLORS.muted } };
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(3).height = 22;
  return 5;
}

function addSectionHeading(
  sheet: ExcelJS.Worksheet,
  row: number,
  title: string,
  endColumn: number,
  subtitle?: string,
): number {
  sheet.mergeCells(row, 1, row, endColumn);
  const cell = sheet.getCell(row, 1);
  cell.value = title;
  cell.fill = solidFill(COLORS.purpleSoft);
  cell.font = { name: 'Aptos Display', size: 12, bold: true, color: { argb: COLORS.purpleDark } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  cell.border = { bottom: { style: 'medium', color: { argb: COLORS.purple } } };
  sheet.getRow(row).height = 24;

  if (!subtitle) return row + 1;
  sheet.mergeCells(row + 1, 1, row + 1, endColumn);
  const subtitleCell = sheet.getCell(row + 1, 1);
  subtitleCell.value = subtitle;
  subtitleCell.font = { name: 'Aptos', size: 9, color: { argb: COLORS.muted } };
  subtitleCell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
  sheet.getRow(row + 1).height = 28;
  return row + 2;
}

function addTable<T extends Record<string, unknown>>(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  columns: ReportColumn<T>[],
  rows: T[],
  options: { freeze?: boolean; autoFilter?: boolean } = {},
): number {
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  const headerRow = sheet.getRow(startRow);
  columns.forEach((column, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = column.header;
    cell.fill = solidFill(COLORS.purple);
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    applyThinBorder(cell);
  });
  headerRow.height = 28;

  if (!rows.length) {
    sheet.mergeCells(startRow + 1, 1, startRow + 2, columns.length);
    const empty = sheet.getCell(startRow + 1, 1);
    empty.value = 'No records are available for this section.';
    empty.fill = solidFill(COLORS.soft);
    empty.font = { name: 'Aptos', size: 10, italic: true, color: { argb: COLORS.muted } };
    empty.alignment = { vertical: 'middle', horizontal: 'center' };
    return startRow + 3;
  }

  rows.forEach((item, itemIndex) => {
    const excelRow = sheet.getRow(startRow + itemIndex + 1);
    columns.forEach((column, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 1);
      cell.value = item[column.key as keyof T] as ExcelJS.CellValue;
      if (column.numFmt && typeof cell.value === 'number') cell.numFmt = column.numFmt;
      cell.font = { name: 'Aptos', size: 9.5, color: { argb: COLORS.ink } };
      cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
      if (itemIndex % 2 === 1) cell.fill = solidFill(COLORS.soft);
      applyThinBorder(cell);
    });
    excelRow.height = 22;
  });

  if (options.autoFilter !== false) {
    sheet.autoFilter = {
      from: { row: startRow, column: 1 },
      to: { row: startRow, column: columns.length },
    };
  }
  if (options.freeze) sheet.views = [{ state: 'frozen', ySplit: startRow, xSplit: 0 }];
  return startRow + rows.length + 2;
}

function scoreTone(score: number, target = 95): { fill: string; font: string } {
  if (score >= target) return { fill: COLORS.greenSoft, font: COLORS.green };
  if (score >= Math.max(0, target - 10)) return { fill: COLORS.amberSoft, font: COLORS.amber };
  return { fill: COLORS.redSoft, font: COLORS.red };
}

function severityRank(severity: RuleSeverity): number {
  return ({ Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 })[severity];
}

function statusLabel(rule: RuleResult): string {
  return rule.score >= rule.threshold ? 'Within threshold' : 'Threshold breached';
}

function ruleTypeLabel(ruleType?: RuleType): string {
  return ({
    'not-null': 'Required value',
    unique: 'Unique value',
    type: 'Data type',
    pattern: 'Pattern / format',
    freshness: 'Freshness',
    range: 'Numeric range',
    'allowed-values': 'Allowed values',
    'min-length': 'Minimum length',
    'max-length': 'Maximum length',
  } as Partial<Record<RuleType, string>>)[ruleType ?? 'not-null'] ?? 'Configured check';
}

function expectedDescription(rule?: QualityRule): string {
  if (!rule) return 'See the rule name for the expected condition.';
  switch (rule.ruleType) {
    case 'not-null': return 'Value must be present.';
    case 'unique': return 'Value must be present and occur only once.';
    case 'type': return `Expected ${rule.expectedValue || 'configured'} datatype.`;
    case 'pattern': return `Must match ${rule.expectedValue || 'the configured pattern'}.`;
    case 'freshness': return `Date must be no more than ${rule.expectedValue || '30'} days old.`;
    case 'range': {
      const minimum = rule.expectedValue?.trim();
      const maximum = rule.secondaryValue?.trim();
      if (minimum && maximum) return `Between ${minimum} and ${maximum}, inclusive.`;
      if (minimum) return `At least ${minimum}.`;
      if (maximum) return `No more than ${maximum}.`;
      return 'Within the configured numeric range.';
    }
    case 'allowed-values': return `One of: ${rule.expectedValue || 'configured values'}.`;
    case 'min-length': return `At least ${rule.expectedValue || '0'} characters.`;
    case 'max-length': return `No more than ${rule.expectedValue || 'the configured limit'} characters.`;
    default: return 'Configured condition.';
  }
}

function inferredColumnFromRuleName(name: string): string {
  return name.match(/^(.*?)\s+(?:is|has|follows)\b/i)?.[1]?.trim() ?? '';
}

function inferredRuleType(name: string): RuleType | undefined {
  const normalized = name.toLowerCase();
  if (normalized.includes('required') || normalized.includes('populated')) return 'not-null';
  if (normalized.includes('unique')) return 'unique';
  if (normalized.includes('pattern') || normalized.includes('format')) return 'pattern';
  if (normalized.includes('old') || normalized.includes('fresh')) return 'freshness';
  if (normalized.includes('type') || normalized.includes('values')) return 'type';
  return undefined;
}

function percentage(value: number): number {
  return value / 100;
}

function change(current: number, previous?: number): number | undefined {
  return previous === undefined ? undefined : current - previous;
}

function relativeChange(current: number, previous?: number): number | undefined {
  if (previous === undefined || previous === 0) return undefined;
  return (current - previous) / previous;
}

function metricCard(
  sheet: ExcelJS.Worksheet,
  startColumn: number,
  label: string,
  value: string | number,
  fill: string,
  font: string,
): void {
  sheet.mergeCells(8, startColumn, 8, startColumn + 1);
  sheet.mergeCells(9, startColumn, 10, startColumn + 1);
  const labelCell = sheet.getCell(8, startColumn);
  labelCell.value = label;
  labelCell.fill = solidFill(fill);
  labelCell.font = { name: 'Aptos', size: 9, bold: true, color: { argb: font } };
  labelCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  const valueCell = sheet.getCell(9, startColumn);
  valueCell.value = value;
  valueCell.fill = solidFill(fill);
  valueCell.font = { name: 'Aptos Display', size: 20, bold: true, color: { argb: font } };
  valueCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  for (let row = 8; row <= 10; row += 1) {
    for (let column = startColumn; column <= startColumn + 1; column += 1) applyThinBorder(sheet.getCell(row, column));
  }
}

function createExecutiveSummary(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, run, issues, previousRun, monitor } = context;
  const sheet = workbook.addWorksheet('Executive Summary', { properties: { tabColor: { argb: COLORS.purple } } });
  configureSheet(sheet, false);
  for (let index = 1; index <= 8; index += 1) sheet.getColumn(index).width = 15;

  addReportTitle(
    sheet,
    'DATA QUALITY REPORT',
    `${dataset.name} · ${new Date(run.createdAt).toLocaleString()} · ${run.fileName}`,
    8,
  );

  const metadata = [
    ['Data asset', dataset.name, 'Owner / steward', dataset.owner || 'Not assigned'],
    ['Source', run.sourceReference || run.fileName, 'Profiled at', new Date(run.createdAt).toLocaleString()],
  ];
  metadata.forEach((values, index) => {
    const row = sheet.getRow(5 + index);
    row.values = [values[0], values[1], '', '', values[2], values[3]];
    sheet.mergeCells(5 + index, 2, 5 + index, 4);
    sheet.mergeCells(5 + index, 6, 5 + index, 8);
    [1, 5].forEach((column) => {
      const cell = row.getCell(column);
      cell.font = { name: 'Aptos', size: 9, bold: true, color: { argb: COLORS.muted } };
    });
    [2, 6].forEach((column) => {
      const cell = row.getCell(column);
      cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: COLORS.ink } };
      cell.alignment = { wrapText: true };
    });
  });

  const ruleResults = run.quality.ruleResults ?? [];
  const breachedRules = ruleResults.filter((rule) => rule.score < rule.threshold);
  const openIssues = issues.filter((issue) => issue.status === 'Open' || issue.status === 'Acknowledged');
  const allRuleScore = recordComplianceScore(run.quality);
  const noRulesEvaluated = ruleResults.length === 0;
  const overallTarget = monitor?.minimumOverallQuality ?? 95;
  const overallTone = scoreTone(run.quality.overallScore, overallTarget);
  const allRuleTone = scoreTone(allRuleScore, monitor?.minimumRecordCompliance ?? 95);

  metricCard(sheet, 1, 'Overall DQ score', noRulesEvaluated ? 'N/A' : `${run.quality.overallScore.toFixed(1)}%`, noRulesEvaluated ? COLORS.amberSoft : overallTone.fill, noRulesEvaluated ? COLORS.amber : overallTone.font);
  metricCard(sheet, 3, 'Records passing all active rules', noRulesEvaluated ? 'N/A' : `${allRuleScore.toFixed(1)}%`, noRulesEvaluated ? COLORS.amberSoft : allRuleTone.fill, noRulesEvaluated ? COLORS.amber : allRuleTone.font);
  metricCard(sheet, 5, 'Rules within threshold', `${ruleResults.length - breachedRules.length} of ${ruleResults.length}`, noRulesEvaluated || breachedRules.length ? COLORS.amberSoft : COLORS.greenSoft, noRulesEvaluated || breachedRules.length ? COLORS.amber : COLORS.green);
  metricCard(sheet, 7, 'Open findings', openIssues.length, openIssues.length ? COLORS.redSoft : COLORS.greenSoft, openIssues.length ? COLORS.red : COLORS.green);

  const needsAttention = breachedRules.length > 0 || openIssues.some((issue) => issue.severity === 'Critical' || issue.severity === 'High');
  sheet.mergeCells('A12:H13');
  const status = sheet.getCell('A12');
  status.value = noRulesEvaluated
    ? 'DQ SCORE NOT AVAILABLE · No active data quality rules were evaluated for this run.'
    : needsAttention
      ? `NEEDS ATTENTION · ${breachedRules.length} rule ${breachedRules.length === 1 ? 'threshold was' : 'thresholds were'} breached in this run.`
      : 'NO CONFIGURED RULE BREACHES · This run is within its active rule thresholds.';
  status.fill = solidFill(noRulesEvaluated ? COLORS.amberSoft : needsAttention ? COLORS.redSoft : COLORS.greenSoft);
  status.font = { name: 'Aptos Display', size: 13, bold: true, color: { argb: noRulesEvaluated ? COLORS.amber : needsAttention ? COLORS.red : COLORS.green } };
  status.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  for (let row = 12; row <= 13; row += 1) for (let column = 1; column <= 8; column += 1) applyThinBorder(sheet.getCell(row, column));

  let row = addSectionHeading(
    sheet,
    15,
    'How to read the scores',
    8,
    'The Overall DQ score is the weighted average of active rule pass rates within weighted dimensions. “Records passing all active rules” is a separate, stricter measure: one failed rule causes that record to fail the all-rules measure.',
  );
  const explanationRows = [
    ['Overall DQ score', `${run.quality.overallScore.toFixed(1)}%`, 'Weighted rule and dimension result; it is not a certification that the dataset is fit for every use.'],
    ['Records passing all active rules', `${allRuleScore.toFixed(1)}%`, `${run.quality.passingRecords.toLocaleString()} of ${run.quality.evaluatedRecords.toLocaleString()} records passed every active rule.`],
    ['Rules evaluated', run.quality.rulesEvaluated.toLocaleString(), 'Each rule has its own pass-rate threshold, severity, weight, and assigned dimension.'],
  ];
  explanationRows.forEach((values) => {
    sheet.getCell(row, 1).value = values[0];
    sheet.mergeCells(row, 2, row, 3);
    sheet.getCell(row, 2).value = values[1];
    sheet.mergeCells(row, 4, row, 8);
    sheet.getCell(row, 4).value = values[2];
    [1, 2, 4].forEach((column) => {
      const cell = sheet.getCell(row, column);
      cell.font = { name: 'Aptos', size: 9.5, bold: column !== 4, color: { argb: column === 4 ? COLORS.muted : COLORS.ink } };
      cell.alignment = { vertical: 'top', wrapText: true };
    });
    row += 1;
  });

  row += 1;
  row = addSectionHeading(
    sheet,
    row,
    'Change from the preceding run',
    8,
    previousRun ? `Compared with ${new Date(previousRun.createdAt).toLocaleString()} · ${previousRun.fileName}` : 'No earlier saved run is available for comparison.',
  );
  const comparisons = [
    { metric: 'Rows', current: run.rowCount, previous: previousRun?.rowCount, delta: change(run.rowCount, previousRun?.rowCount), relative: relativeChange(run.rowCount, previousRun?.rowCount) },
    { metric: 'Missing cells %', current: percentage(run.missingPercentage), previous: previousRun ? percentage(previousRun.missingPercentage) : undefined, delta: previousRun ? percentage(run.missingPercentage - previousRun.missingPercentage) : undefined },
    { metric: 'Duplicate rows', current: run.duplicateRows, previous: previousRun?.duplicateRows, delta: change(run.duplicateRows, previousRun?.duplicateRows) },
    { metric: 'Overall DQ score', current: percentage(run.quality.overallScore), previous: previousRun ? percentage(previousRun.quality.overallScore) : undefined, delta: previousRun ? percentage(run.quality.overallScore - previousRun.quality.overallScore) : undefined },
  ];
  row = addTable(sheet, row, [
    { header: 'Metric', key: 'metric', width: 28 },
    { header: 'Current run', key: 'current', width: 18 },
    { header: 'Previous run', key: 'previous', width: 18 },
    { header: 'Absolute change', key: 'delta', width: 18 },
    { header: 'Relative row change', key: 'relative', width: 20 },
  ], previousRun ? comparisons : [], { autoFilter: false });
  if (previousRun) {
    const firstDataRow = row - comparisons.length - 1;
    sheet.getCell(firstDataRow, 5).numFmt = '0.0%';
    [firstDataRow + 1, firstDataRow + 3].forEach((percentageRow) => {
      [2, 3, 4].forEach((column) => { sheet.getCell(percentageRow, column).numFmt = '+0.0%;-0.0%;0.0%'; });
    });
  }

  row = addSectionHeading(
    sheet,
    row,
    'Priority findings',
    8,
    'Rule breaches are listed first, followed by other open findings from this profiling run.',
  );
  const findings = [
    ...breachedRules
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.score - b.score)
      .map((rule) => ({
        priority: rule.severity,
        finding: rule.ruleName,
        result: `${rule.score.toFixed(1)}% pass rate`,
        threshold: `${rule.threshold.toFixed(1)}% required`,
        detail: `${rule.failingRecords.toLocaleString()} records failed this rule.`,
      })),
    ...openIssues
      .filter((issue) => issue.category !== 'Data quality')
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .map((issue) => ({
        priority: issue.severity,
        finding: issue.title,
        result: issue.currentValue || issue.status,
        threshold: issue.previousValue || '',
        detail: issue.description,
      })),
  ].slice(0, 10);
  addTable(sheet, row, [
    { header: 'Priority', key: 'priority', width: 13 },
    { header: 'Finding', key: 'finding', width: 36 },
    { header: 'Current result', key: 'result', width: 20 },
    { header: 'Expected / comparison', key: 'threshold', width: 22 },
    { header: 'Details', key: 'detail', width: 54 },
  ], findings, { autoFilter: false });

  sheet.views = [{ state: 'frozen', ySplit: 4 }];
}

function createDimensionSheet(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, run, dimensions = [] } = context;
  const sheet = workbook.addWorksheet('DQ Dimensions', { properties: { tabColor: { argb: COLORS.purple } } });
  configureSheet(sheet);
  const row = addReportTitle(sheet, 'DATA QUALITY BY DIMENSION', `${dataset.name} · weighted results for ${run.quality.rulesEvaluated} active rules`, 9);
  const definitionMap = new Map(dimensions.map((dimension) => [dimension.name.toLowerCase(), dimension]));
  const rules = run.quality.ruleResults ?? [];
  const totalDimensionWeight = run.quality.dimensions.reduce((sum, dimension) => sum + (dimension.weight ?? 1), 0) || 1;
  const rows = run.quality.dimensions
    .map((dimension) => ({
      status: rules.some((rule) => rule.dimension === dimension.dimension && rule.score < rule.threshold) ? 'Has rule breaches' : 'Within thresholds',
      dimension: dimension.dimension,
      definition: definitionMap.get(dimension.dimension.toLowerCase())?.description || 'User-defined or run-specific data quality dimension.',
      score: percentage(dimension.score),
      weight: dimension.weight ?? 1,
      contribution: percentage(dimension.score * (dimension.weight ?? 1) / totalDimensionWeight),
      activeRules: dimension.activeRules,
      breachedRules: rules.filter((rule) => rule.dimension === dimension.dimension && rule.score < rule.threshold).length,
      allRulesPass: run.quality.evaluatedRecords ? dimension.passingRecords / run.quality.evaluatedRecords : 1,
    }))
    .sort((a, b) => a.score - b.score);

  addTable(sheet, row, [
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Dimension', key: 'dimension', width: 22 },
    { header: 'What it measures', key: 'definition', width: 55 },
    { header: 'Weighted score', key: 'score', width: 17, numFmt: '0.0%' },
    { header: 'Dimension weight', key: 'weight', width: 17 },
    { header: 'Contribution to overall score', key: 'contribution', width: 24, numFmt: '0.0%' },
    { header: 'Active rules', key: 'activeRules', width: 14 },
    { header: 'Rules below threshold', key: 'breachedRules', width: 20 },
    { header: 'Records passing every rule in dimension', key: 'allRulesPass', width: 28, numFmt: '0.0%' },
  ], rows, { freeze: true });

  rows.forEach((item, index) => {
    const excelRow = 6 + index;
    const statusCell = sheet.getCell(excelRow, 1);
    statusCell.fill = solidFill(item.breachedRules ? COLORS.redSoft : COLORS.greenSoft);
    statusCell.font = { name: 'Aptos', size: 9.5, bold: true, color: { argb: item.breachedRules ? COLORS.red : COLORS.green } };
    const scoreCell = sheet.getCell(excelRow, 4);
    const tone = scoreTone(item.score * 100);
    scoreCell.fill = solidFill(tone.fill);
    scoreCell.font = { name: 'Aptos', size: 9.5, bold: true, color: { argb: tone.font } };
  });
}

function createRuleSheet(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, run, rules = [] } = context;
  const sheet = workbook.addWorksheet('DQ Rules', { properties: { tabColor: { argb: COLORS.purple } } });
  configureSheet(sheet);
  const ruleMap = new Map(rules.map((rule) => [rule.id, rule]));
  const ruleRows = (run.quality.ruleResults ?? [])
    .map((result) => {
      const definition = ruleMap.get(result.ruleId);
      const ruleType = definition?.ruleType ?? inferredRuleType(result.ruleName);
      return {
        status: statusLabel(result),
        severity: result.severity,
        rule: result.ruleName,
        dimension: result.dimension,
        column: definition?.columnName || inferredColumnFromRuleName(result.ruleName) || 'Not retained for this older run',
        check: ruleTypeLabel(ruleType),
        expected: expectedDescription(definition),
        passRate: percentage(result.score),
        threshold: percentage(result.threshold),
        gap: percentage(result.score - result.threshold),
        failedRecords: result.failingRecords,
        evaluatedRecords: result.passingRecords + result.failingRecords,
        weight: result.weight,
      };
    })
    .sort((a, b) => {
      const aBreach = a.status === 'Threshold breached' ? 0 : 1;
      const bBreach = b.status === 'Threshold breached' ? 0 : 1;
      return aBreach - bBreach || severityRank(a.severity) - severityRank(b.severity) || a.passRate - b.passRate;
    });

  const row = addReportTitle(sheet, 'DATA QUALITY RULE RESULTS', `${dataset.name} · each rule compared with its configured pass-rate threshold`, 13);
  addTable(sheet, row, [
    { header: 'Status', key: 'status', width: 22 },
    { header: 'Severity', key: 'severity', width: 13 },
    { header: 'Rule', key: 'rule', width: 38 },
    { header: 'Dimension', key: 'dimension', width: 20 },
    { header: 'Column', key: 'column', width: 25 },
    { header: 'Check type', key: 'check', width: 20 },
    { header: 'Expected condition', key: 'expected', width: 48 },
    { header: 'Pass rate', key: 'passRate', width: 14, numFmt: '0.0%' },
    { header: 'Required pass rate', key: 'threshold', width: 18, numFmt: '0.0%' },
    { header: 'Gap to threshold', key: 'gap', width: 17, numFmt: '+0.0%;-0.0%;0.0%' },
    { header: 'Failed records', key: 'failedRecords', width: 16 },
    { header: 'Evaluated records', key: 'evaluatedRecords', width: 18 },
    { header: 'Weight', key: 'weight', width: 10 },
  ], ruleRows, { freeze: true });

  ruleRows.forEach((item, index) => {
    const excelRow = row + index + 1;
    const statusCell = sheet.getCell(excelRow, 1);
    const breached = item.status === 'Threshold breached';
    statusCell.fill = solidFill(breached ? COLORS.redSoft : COLORS.greenSoft);
    statusCell.font = { name: 'Aptos', size: 9.5, bold: true, color: { argb: breached ? COLORS.red : COLORS.green } };
    const gapCell = sheet.getCell(excelRow, 10);
    gapCell.font = { name: 'Aptos', size: 9.5, bold: true, color: { argb: item.gap < 0 ? COLORS.red : COLORS.green } };
  });
}

function createIssueSheet(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, issues } = context;
  const sheet = workbook.addWorksheet('Findings & Issues', { properties: { tabColor: { argb: COLORS.red } } });
  configureSheet(sheet);
  const rows = [...issues]
    .sort((a, b) => {
      const aOpen = a.status === 'Open' || a.status === 'Acknowledged' ? 0 : 1;
      const bOpen = b.status === 'Open' || b.status === 'Acknowledged' ? 0 : 1;
      return aOpen - bOpen || severityRank(a.severity) - severityRank(b.severity) || b.createdAt.localeCompare(a.createdAt);
    })
    .map((issue) => ({
      status: issue.status,
      severity: issue.severity,
      category: issue.category,
      finding: issue.title,
      description: issue.description,
      metric: issue.metric || '',
      current: issue.currentValue || '',
      comparison: issue.previousValue || '',
      created: new Date(issue.createdAt).toLocaleString(),
    }));

  const row = addReportTitle(sheet, 'FINDINGS AND ISSUES', `${dataset.name} · DQ failures and observability findings created from this run`, 9);
  addTable(sheet, row, [
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Severity', key: 'severity', width: 13 },
    { header: 'Category', key: 'category', width: 21 },
    { header: 'Finding', key: 'finding', width: 42 },
    { header: 'What was detected', key: 'description', width: 68 },
    { header: 'Metric / rule', key: 'metric', width: 28 },
    { header: 'Current result', key: 'current', width: 20 },
    { header: 'Expected / previous', key: 'comparison', width: 22 },
    { header: 'Created', key: 'created', width: 22 },
  ], rows, { freeze: true });

  rows.forEach((item, index) => {
    const excelRow = row + index + 1;
    const severityCell = sheet.getCell(excelRow, 2);
    const tone = item.severity === 'Critical' || item.severity === 'High'
      ? { fill: COLORS.redSoft, font: COLORS.red }
      : item.severity === 'Medium'
        ? { fill: COLORS.amberSoft, font: COLORS.amber }
        : { fill: COLORS.blueSoft, font: COLORS.purpleDark };
    severityCell.fill = solidFill(tone.fill);
    severityCell.font = { name: 'Aptos', size: 9.5, bold: true, color: { argb: tone.font } };
  });
}

function createProfileSheet(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, run } = context;
  const sheet = workbook.addWorksheet('Data Profile', { properties: { tabColor: { argb: COLORS.green } } });
  configureSheet(sheet);
  let row = addReportTitle(sheet, 'SUPPORTING DATA PROFILE', `${dataset.name} · factual profiling metrics supporting the DQ evaluation`, 15);

  row = addSectionHeading(sheet, row, 'Dataset-level profile', 15, 'These are factual profiling results. They do not independently determine whether the data is accurate or fit for a particular business use.');
  const overviewRows = [
    { metric: 'Rows', value: run.rowCount, meaning: 'Records read from the selected source.' },
    { metric: 'Columns', value: run.columnCount, meaning: 'Columns included in the profile.' },
    { metric: 'Missing cells', value: run.missingCells, meaning: `${run.missingPercentage.toFixed(2)}% of all row-column cells were null-like.` },
    { metric: 'Duplicate rows', value: run.duplicateRows, meaning: 'Additional rows that exactly matched an earlier row across every profiled column.' },
    { metric: 'Estimated memory footprint', value: run.memoryUsageMB === undefined ? 'Not captured for this older run' : `${run.memoryUsageMB.toFixed(3)} MB`, meaning: 'Approximate in-browser representation size, not source-file size.' },
  ];
  row = addTable(sheet, row, [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Result', key: 'value', width: 24 },
    { header: 'What it means', key: 'meaning', width: 74 },
  ], overviewRows, { autoFilter: false });

  row = addSectionHeading(
    sheet,
    row,
    'Column-level profile',
    15,
    '“Distinct values” counts different non-null values. “Values appearing once” counts non-null values that occur in exactly one record. It is not the same as the number of distinct values.',
  );
  const profileRows = run.columns.map((column) => ({
    column: column.name,
    type: column.inferredType,
    classification: column.classification || '',
    nonNull: column.nonNullCount,
    missing: column.missingCount,
    missingPct: percentage(column.missingPercentage),
    distinct: column.distinctCount,
    distinctPct: column.nonNullCount ? column.distinctCount / column.nonNullCount : 0,
    valuesOnce: column.uniqueCount,
    valuesOncePct: percentage(column.uniquenessPercentage),
    repeatedRows: column.duplicateValueCount,
    likelyKey: column.likelyKey ? 'Yes' : 'No',
    outliers: column.outlierCount,
    topValue: column.topValues[0]?.value || '',
    topCount: column.topValues[0]?.count ?? '',
  }));
  addTable(sheet, row, [
    { header: 'Column', key: 'column', width: 28 },
    { header: 'Inferred type', key: 'type', width: 16 },
    { header: 'Classification', key: 'classification', width: 20 },
    { header: 'Non-null rows', key: 'nonNull', width: 15 },
    { header: 'Missing rows', key: 'missing', width: 15 },
    { header: 'Missing %', key: 'missingPct', width: 13, numFmt: '0.0%' },
    { header: 'Distinct values', key: 'distinct', width: 16 },
    { header: 'Distinct / non-null', key: 'distinctPct', width: 18, numFmt: '0.0%' },
    { header: 'Values appearing once', key: 'valuesOnce', width: 20 },
    { header: 'Rows with one-time values', key: 'valuesOncePct', width: 23, numFmt: '0.0%' },
    { header: 'Rows with repeated values', key: 'repeatedRows', width: 23 },
    { header: 'Likely key candidate', key: 'likelyKey', width: 20 },
    { header: 'IQR outliers', key: 'outliers', width: 14 },
    { header: 'Most frequent value', key: 'topValue', width: 32 },
    { header: 'Frequency', key: 'topCount', width: 13 },
  ], profileRows, { freeze: true });
}

function createStatisticsSheet(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, run } = context;
  const sheet = workbook.addWorksheet('Column Statistics', { properties: { tabColor: { argb: COLORS.green } } });
  configureSheet(sheet);
  const rows = run.columns.map((column) => ({
    column: column.name,
    type: column.inferredType,
    minimum: column.numericStats?.min ?? '',
    q1: column.numericStats?.q1 ?? '',
    median: column.numericStats?.median ?? '',
    mean: column.numericStats?.mean ?? '',
    q3: column.numericStats?.q3 ?? '',
    maximum: column.numericStats?.max ?? '',
    stdDev: column.numericStats?.standardDeviation ?? '',
    skewness: column.numericStats?.skewness ?? '',
    kurtosis: column.numericStats?.kurtosis ?? '',
    minLength: column.textStats?.minLength ?? '',
    avgLength: column.textStats?.meanLength ?? '',
    maxLength: column.textStats?.maxLength ?? '',
    earliest: column.dateStats?.min ? column.dateStats.min.slice(0, 10) : '',
    latest: column.dateStats?.max ? column.dateStats.max.slice(0, 10) : '',
    rangeDays: column.dateStats?.rangeDays ?? '',
    pattern: column.dominantPattern ?? '',
    patternCoverage: column.dominantPatternPercentage === undefined ? '' : percentage(column.dominantPatternPercentage),
  }));
  const row = addReportTitle(sheet, 'COLUMN STATISTICS', `${dataset.name} · numerical distribution, text length, date range, outlier, and pattern details`, 19);
  addTable(sheet, row, [
    { header: 'Column', key: 'column', width: 28 },
    { header: 'Type', key: 'type', width: 14 },
    { header: 'Minimum', key: 'minimum', width: 15, numFmt: '0.####' },
    { header: 'Q1', key: 'q1', width: 13, numFmt: '0.####' },
    { header: 'Median', key: 'median', width: 13, numFmt: '0.####' },
    { header: 'Mean', key: 'mean', width: 13, numFmt: '0.####' },
    { header: 'Q3', key: 'q3', width: 13, numFmt: '0.####' },
    { header: 'Maximum', key: 'maximum', width: 15, numFmt: '0.####' },
    { header: 'Std. deviation', key: 'stdDev', width: 16, numFmt: '0.####' },
    { header: 'Skewness', key: 'skewness', width: 14, numFmt: '0.####' },
    { header: 'Excess kurtosis', key: 'kurtosis', width: 17, numFmt: '0.####' },
    { header: 'Min text length', key: 'minLength', width: 17 },
    { header: 'Avg text length', key: 'avgLength', width: 17, numFmt: '0.0' },
    { header: 'Max text length', key: 'maxLength', width: 17 },
    { header: 'Earliest date', key: 'earliest', width: 16 },
    { header: 'Latest date', key: 'latest', width: 16 },
    { header: 'Date range days', key: 'rangeDays', width: 17, numFmt: '0.0' },
    { header: 'Dominant pattern', key: 'pattern', width: 28 },
    { header: 'Pattern coverage', key: 'patternCoverage', width: 18, numFmt: '0.0%' },
  ], rows, { freeze: true });
}

function correlationValue(run: ProfileRun, left: string, right: string): number | undefined {
  if (left === right) return 1;
  return run.correlations?.find((item) =>
    (item.left === left && item.right === right) || (item.left === right && item.right === left),
  )?.value;
}

function createCorrelationSheet(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, run } = context;
  const sheet = workbook.addWorksheet('Correlations', { properties: { tabColor: { argb: COLORS.green } } });
  configureSheet(sheet);
  const numeric = run.columns
    .filter((column) => column.inferredType === 'integer' || column.inferredType === 'decimal')
    .map((column) => column.name);
  addReportTitle(sheet, 'NUMERIC CORRELATION MATRIX', `${dataset.name} · Pearson correlation; correlation does not prove causation`, Math.max(2, numeric.length + 1));
  sheet.getColumn(1).width = 28;
  numeric.forEach((name, index) => {
    sheet.getColumn(index + 2).width = Math.max(12, Math.min(24, name.length + 3));
  });

  if (numeric.length < 2) {
    sheet.mergeCells(5, 1, 7, 4);
    const cell = sheet.getCell(5, 1);
    cell.value = 'At least two numeric columns are required to calculate a correlation matrix.';
    cell.fill = solidFill(COLORS.soft);
    cell.font = { name: 'Aptos', size: 10, italic: true, color: { argb: COLORS.muted } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    return;
  }

  const headerRow = sheet.getRow(5);
  headerRow.getCell(1).value = 'Column';
  numeric.forEach((name, index) => { headerRow.getCell(index + 2).value = name; });
  for (let column = 1; column <= numeric.length + 1; column += 1) {
    const cell = headerRow.getCell(column);
    cell.fill = solidFill(COLORS.purple);
    cell.font = { name: 'Aptos', size: 9, bold: true, color: { argb: COLORS.white } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', textRotation: column === 1 ? 0 : 45 };
    applyThinBorder(cell);
  }
  headerRow.height = 55;

  numeric.forEach((left, rowIndex) => {
    const excelRow = sheet.getRow(rowIndex + 6);
    const label = excelRow.getCell(1);
    label.value = left;
    label.fill = solidFill(COLORS.purpleSoft);
    label.font = { name: 'Aptos', size: 9, bold: true, color: { argb: COLORS.purpleDark } };
    applyThinBorder(label);
    numeric.forEach((right, columnIndex) => {
      const cell = excelRow.getCell(columnIndex + 2);
      const value = correlationValue(run, left, right);
      cell.value = value ?? null;
      cell.numFmt = '0.00';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      const absolute = Math.abs(value ?? 0);
      cell.fill = solidFill(
        left === right ? COLORS.purpleDark
          : absolute >= 0.8 ? 'FFB7B7F3'
            : absolute >= 0.5 ? 'FFD9D9FA'
              : COLORS.soft,
      );
      cell.font = { name: 'Aptos', size: 9, bold: left === right || absolute >= 0.8, color: { argb: left === right ? COLORS.white : COLORS.ink } };
      applyThinBorder(cell);
    });
  });
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 5 }];
}

function createTopValuesSheet(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, run } = context;
  const sheet = workbook.addWorksheet('Top Values & Patterns', { properties: { tabColor: { argb: COLORS.green } } });
  configureSheet(sheet);
  let row = addReportTitle(sheet, 'TOP VALUES AND PATTERNS', `${dataset.name} · supporting distributions retained in this saved profile`, 6);

  row = addSectionHeading(sheet, row, 'Most frequent values', 6, 'Percentages use the non-null count for the applicable column.');
  const topRows = run.columns.flatMap((column) => column.topValues.map((value, index) => ({
    column: column.name,
    rank: index + 1,
    value: value.value,
    count: value.count,
    percentage: percentage(value.percentage),
    basis: `${column.nonNullCount.toLocaleString()} non-null rows`,
  })));
  row = addTable(sheet, row, [
    { header: 'Column', key: 'column', width: 28 },
    { header: 'Rank', key: 'rank', width: 10 },
    { header: 'Value', key: 'value', width: 48 },
    { header: 'Count', key: 'count', width: 14 },
    { header: '% of non-null rows', key: 'percentage', width: 20, numFmt: '0.0%' },
    { header: 'Percentage basis', key: 'basis', width: 22 },
  ], topRows);

  row = addSectionHeading(sheet, row, 'Observed value patterns', 6, 'Letters and digits are generalized to pattern symbols to highlight common formats.');
  const patternRows = run.columns.flatMap((column) => column.patterns.map((pattern, index) => ({
    column: column.name,
    rank: index + 1,
    pattern: pattern.pattern,
    count: pattern.count,
    percentage: percentage(pattern.percentage),
    basis: `${column.nonNullCount.toLocaleString()} non-null rows`,
  })));
  addTable(sheet, row, [
    { header: 'Column', key: 'column', width: 28 },
    { header: 'Rank', key: 'rank', width: 10 },
    { header: 'Pattern', key: 'pattern', width: 48 },
    { header: 'Count', key: 'count', width: 14 },
    { header: '% of non-null rows', key: 'percentage', width: 20, numFmt: '0.0%' },
    { header: 'Percentage basis', key: 'basis', width: 22 },
  ], patternRows);
}

function createThresholdSheet(workbook: ExcelJS.Workbook, context: DataQualityReportContext): void {
  const { dataset, run, previousRun, monitor } = context;
  const sheet = workbook.addWorksheet('Monitoring Thresholds', { properties: { tabColor: { argb: COLORS.amber } } });
  configureSheet(sheet);
  const row = addReportTitle(sheet, 'MONITORING THRESHOLDS', `${dataset.name} · dataset-level alert conditions configured for recurring runs`, 5);
  const rows = monitor ? [
    {
      status: monitor.minimumOverallQuality === undefined || run.quality.overallScore >= monitor.minimumOverallQuality ? 'Within threshold' : 'Breached',
      metric: 'Overall DQ score',
      current: `${run.quality.overallScore.toFixed(1)}%`,
      threshold: monitor.minimumOverallQuality === undefined ? 'Not configured' : `At least ${monitor.minimumOverallQuality}%`,
      explanation: 'Weighted result across active DQ dimensions.',
    },
    {
      status: monitor.minimumRecordCompliance === undefined || recordComplianceScore(run.quality) >= monitor.minimumRecordCompliance ? 'Within threshold' : 'Breached',
      metric: 'Records passing all active rules',
      current: `${recordComplianceScore(run.quality).toFixed(1)}%`,
      threshold: monitor.minimumRecordCompliance === undefined ? 'Not configured' : `At least ${monitor.minimumRecordCompliance}%`,
      explanation: 'Percentage of records that passed every active rule.',
    },
    {
      status: monitor.maximumMissingPercent === undefined || run.missingPercentage <= monitor.maximumMissingPercent ? 'Within threshold' : 'Breached',
      metric: 'Missing cells',
      current: `${run.missingPercentage.toFixed(2)}%`,
      threshold: monitor.maximumMissingPercent === undefined ? 'Not configured' : `No more than ${monitor.maximumMissingPercent}%`,
      explanation: 'Null-like cells divided by all row-column cells.',
    },
    {
      status: monitor.maximumDuplicateRows === undefined || run.duplicateRows <= monitor.maximumDuplicateRows ? 'Within threshold' : 'Breached',
      metric: 'Duplicate rows',
      current: run.duplicateRows.toLocaleString(),
      threshold: monitor.maximumDuplicateRows === undefined ? 'Not configured' : `No more than ${monitor.maximumDuplicateRows.toLocaleString()}`,
      explanation: 'Additional rows exactly matching an earlier row.',
    },
    {
      status: monitor.maximumRowChangePercent === undefined || previousRun === undefined || Math.abs(relativeChange(run.rowCount, previousRun.rowCount) ?? 0) * 100 <= monitor.maximumRowChangePercent ? 'Within threshold' : 'Breached',
      metric: 'Row-count change',
      current: previousRun ? `${((relativeChange(run.rowCount, previousRun.rowCount) ?? 0) * 100).toFixed(1)}%` : 'No previous run',
      threshold: monitor.maximumRowChangePercent === undefined ? 'Not configured' : `Absolute change no more than ${monitor.maximumRowChangePercent}%`,
      explanation: 'Change in record count from the preceding saved run.',
    },
  ] : [];

  addTable(sheet, row, [
    { header: 'Status', key: 'status', width: 19 },
    { header: 'Monitored metric', key: 'metric', width: 32 },
    { header: 'Current result', key: 'current', width: 20 },
    { header: 'Configured threshold', key: 'threshold', width: 28 },
    { header: 'What it measures', key: 'explanation', width: 62 },
  ], rows, { freeze: true });
}

export function buildDataQualityWorkbook(context: DataQualityReportContext): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  styleWorkbook(workbook);
  createExecutiveSummary(workbook, context);
  createDimensionSheet(workbook, context);
  createRuleSheet(workbook, context);
  createIssueSheet(workbook, context);
  createThresholdSheet(workbook, context);
  createProfileSheet(workbook, context);
  createStatisticsSheet(workbook, context);
  createCorrelationSheet(workbook, context);
  createTopValuesSheet(workbook, context);
  return workbook;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadDataQualityReport(context: DataQualityReportContext): Promise<void> {
  const workbook = buildDataQualityWorkbook(context);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as BlobPart], { type: REPORT_MIME });
  downloadBlob(
    blob,
    `${safeFileName(context.dataset.name)}_${context.run.createdAt.slice(0, 10)}_data_quality_report.xlsx`,
  );
}

export function downloadTechnicalProfile(dataset: Dataset, run: ProfileRun, issues: Issue[]): void {
  const blob = new Blob([JSON.stringify({ dataset, run, issues }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${safeFileName(dataset.name)}_${run.createdAt.slice(0, 10)}_profile.json`);
}
