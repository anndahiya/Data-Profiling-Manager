import { useState } from 'react';
import { Download, FileJson2, LoaderCircle } from 'lucide-react';
import { Navigate, useParams } from 'react-router-dom';
import { AdvancedProfileTable, CorrelationMatrix } from '../AdvancedProfileSections';
import { DimensionBars, IssueTable, MetricCard, PageHeader } from '../components';
import { downloadDataQualityReport, downloadTechnicalProfile } from '../reportExport';
import { recordComplianceScore, scoringDescription } from '../scoring';
import type { WorkspaceSnapshot } from '../types';
import { formatDate } from '../utils';
import { ColumnProfileTable } from './AssetsPage';

export function RunReportPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const { runId } = useParams();
  const run = workspace.runs.find((item) => item.id === runId);
  const dataset = workspace.datasets.find((item) => item.id === run?.datasetId);
  const [tab, setTab] = useState('Summary');
  const [downloading, setDownloading] = useState(false);
  if (!run || !dataset) return <Navigate to="/history" replace />;
  const issues = workspace.issues.filter((issue) => issue.runId === run.id);
  const strictScore = recordComplianceScore(run.quality);
  const constantColumns = run.columns.filter((column) => column.classification === 'Constant').length;
  const keyCandidates = run.columns.filter((column) => column.classification === 'Likely key' || column.likelyKey).length;
  const previousRun = workspace.runs
    .filter((item) => item.datasetId === run.datasetId && item.createdAt < run.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const monitor = workspace.monitors?.find((policy) => policy.datasetId === run.datasetId);
  const rules = workspace.rules.filter((rule) => rule.datasetId === run.datasetId);

  const downloadReport = async () => {
    setDownloading(true);
    try {
      await downloadDataQualityReport({
        dataset,
        run,
        issues,
        previousRun,
        monitor,
        rules,
        dimensions: workspace.dimensions,
      });
    } finally {
      setDownloading(false);
    }
  };

  return <>
    <PageHeader
      backTo="/history"
      eyebrow={`${dataset.name} · Profiling run`}
      title={run.fileName}
      description={`${formatDate(run.createdAt)} · ${run.sourceKind}`}
      actions={<div className="button-row"><button className="primary-button" disabled={downloading} onClick={() => void downloadReport()}>{downloading ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />} {downloading ? 'Building report…' : 'Download DQ report'}</button><button className="secondary-button" onClick={() => downloadTechnicalProfile(dataset, run, issues)}><FileJson2 size={16} /> Export JSON</button></div>}
    />
    <div className="metric-grid five"><MetricCard label="Rows" value={run.rowCount.toLocaleString()} /><MetricCard label="Columns" value={String(run.columnCount)} /><MetricCard label="Duplicate rows" value={run.duplicateRows.toLocaleString()} /><MetricCard label="Overall quality" value={`${run.quality.overallScore.toFixed(1)}%`} detail="Weighted rule and dimension score" /><MetricCard label="Records passing all rules" value={`${strictScore.toFixed(1)}%`} detail="Records passing every active rule" /></div>
    <div className="tabs">{['Summary', 'Column profiles', 'Advanced profile', 'Correlation', 'Data quality', 'Issues'].map((item) => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === 'Summary' && <div className="two-column">
      <section className="panel"><div className="panel-heading"><div><h2>Run summary</h2><p>Deterministic profile and governed rule evaluation</p></div></div><dl className="detail-list"><div><dt>Data asset</dt><dd>{dataset.name}</dd></div><div><dt>Memory footprint</dt><dd>{run.memoryUsageMB === undefined ? 'Not captured for this older run' : `${run.memoryUsageMB.toFixed(2)} MB`}</dd></div><div><dt>Numeric columns</dt><dd>{run.numericColumnCount ?? run.columns.filter((column) => column.inferredType === 'integer' || column.inferredType === 'decimal').length}</dd></div><div><dt>Other columns</dt><dd>{run.otherColumnCount ?? run.columns.filter((column) => column.inferredType !== 'integer' && column.inferredType !== 'decimal').length}</dd></div><div><dt>Constant columns</dt><dd>{constantColumns}</dd></div><div><dt>Likely keys</dt><dd>{keyCandidates}</dd></div><div><dt>Rules evaluated</dt><dd>{run.quality.rulesEvaluated}</dd></div><div><dt>Overall scoring</dt><dd>{scoringDescription(run.quality)}</dd></div></dl></section>
      <section className="panel"><div className="panel-heading"><div><h2>Quality dimensions</h2><p>Weighted rule pass rates by contributing dimension</p></div></div><DimensionBars dimensions={run.quality.dimensions} /></section>
    </div>}
    {tab === 'Column profiles' && <ColumnProfileTable run={run} />}
    {tab === 'Advanced profile' && <AdvancedProfileTable run={run} />}
    {tab === 'Correlation' && <CorrelationMatrix run={run} />}
    {tab === 'Data quality' && <div className="two-column"><section className="panel"><div className="panel-heading"><div><h2>Overall quality</h2><p>Weighted average of active rules and dimension weights.</p></div></div><div className="hero-score"><strong>{run.quality.overallScore.toFixed(1)}%</strong><span>Records passing all active rules: {strictScore.toFixed(1)}%</span></div></section><section className="panel"><div className="panel-heading"><div><h2>Dimension results</h2><p>A zero-scoring dimension lowers the overall score according to its weight; it does not automatically replace the entire score.</p></div></div><DimensionBars dimensions={run.quality.dimensions} /></section>{run.quality.ruleResults?.length ? <section className="panel" style={{ gridColumn: '1 / -1' }}><div className="panel-heading"><div><h2>Rule results</h2><p>Each rule is compared with its configured issue threshold.</p></div></div><div className="table-wrap"><table><thead><tr><th>Rule</th><th>Dimension</th><th>Score</th><th>Threshold</th><th>Weight</th><th>Failed records</th></tr></thead><tbody>{run.quality.ruleResults.map((rule) => <tr key={rule.ruleId}><td><strong>{rule.ruleName}</strong></td><td><span className="category-chip">{rule.dimension}</span></td><td>{rule.score.toFixed(1)}%</td><td>{rule.threshold.toFixed(1)}%</td><td>{rule.weight}</td><td>{rule.failingRecords.toLocaleString()}</td></tr>)}</tbody></table></div></section> : null}</div>}
    {tab === 'Issues' && <IssueTable issues={issues} />}
  </>;
}
