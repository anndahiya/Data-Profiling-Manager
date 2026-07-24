import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, PageHeader } from '../components';
import type { WorkspaceSnapshot } from '../types';
import { formatDate } from '../utils';

function TrendChart({ title, description, data, keys, domain }: { title: string; description: string; data: Array<Record<string, string | number>>; keys: Array<{ key: string; label: string }>; domain?: [number, number] }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div><div className="chart-area small"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} /><YAxis domain={domain} tickLine={false} axisLine={false} /><Tooltip /><Legend />{keys.map((item, index) => <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={index ? '#9799c9' : '#5b5bd6'} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />)}</LineChart></ResponsiveContainer></div></section>;
}

export function TrendsPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const eligible = workspace.datasets.filter((dataset) => workspace.runs.some((run) => run.datasetId === dataset.id));
  const [datasetId, setDatasetId] = useState(eligible[0]?.id ?? '');
  const runs = workspace.runs.filter((run) => run.datasetId === datasetId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const data = runs.map((run) => ({
    date: formatDate(run.createdAt),
    rows: run.rowCount,
    columns: run.columnCount,
    duplicates: run.duplicateRows,
    missing: Number(run.missingPercentage.toFixed(2)),
    memory: run.memoryUsageMB === undefined ? Number.NaN : Number(run.memoryUsageMB.toFixed(3)),
    quality: Number(run.quality.overallScore.toFixed(2)),
    compliance: Number((run.quality.recordComplianceScore ?? (run.rowCount ? run.quality.passingRecords / run.rowCount * 100 : 100)).toFixed(2)),
  }));

  if (!eligible.length) return <><PageHeader title="Profiling trends" description="Track factual profile and data-quality metrics over time." /><EmptyState title="No trend history yet" body="Save at least one profiling run to begin tracking changes." /></>;
  return <>
    <PageHeader title="Profiling trends" description="Track volume, structure, completeness, duplicates, memory, and quality across saved runs." />
    <div className="toolbar"><label className="field trend-dataset-select"><span>Data asset</span><select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{eligible.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><div className="toolbar-summary">{runs.length} saved run{runs.length === 1 ? '' : 's'}</div></div>
    <div className="trend-grid">
      <TrendChart title="Row and column volume" description="Structural size after each completed profile" data={data} keys={[{ key: 'rows', label: 'Rows' }, { key: 'columns', label: 'Columns' }]} />
      <TrendChart title="Missingness and duplicates" description="Missing-cell percentage and exact duplicate row count" data={data} keys={[{ key: 'missing', label: 'Missing %' }, { key: 'duplicates', label: 'Duplicate rows' }]} />
      <TrendChart title="Overall Data Quality" description="Weighted quality score and strict record compliance" data={data} keys={[{ key: 'quality', label: 'Overall DQ %' }, { key: 'compliance', label: 'Strict compliance %' }]} domain={[0, 100]} />
      <TrendChart title="Memory footprint" description="Approximate in-browser size of the profiled row values" data={data} keys={[{ key: 'memory', label: 'Memory MB' }]} />
    </div>
  </>;
}
