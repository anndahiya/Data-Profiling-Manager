import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState, PageHeader } from '../components';
import { hasGovernedQuality, recordComplianceScore } from '../scoring';
import type { WorkspaceSnapshot } from '../types';
import { formatDate } from '../utils';

function TrendChart({ title, description, data, keys, domain }: { title: string; description: string; data: Array<Record<string, string | number | null>>; keys: Array<{ key: string; label: string }>; domain?: [number, number] }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2><p>{description}</p></div></div><div className="chart-area small"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} /><YAxis domain={domain} tickLine={false} axisLine={false} /><Tooltip /><Legend />{keys.map((item, index) => <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={index ? '#9799c9' : '#5b5bd6'} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />)}</LineChart></ResponsiveContainer></div></section>;
}

export function TrendsPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const eligible = workspace.datasets.filter((dataset) => workspace.runs.some((run) => run.datasetId === dataset.id));
  const [datasetId, setDatasetId] = useState(eligible[0]?.id ?? '');
  const runs = workspace.runs.filter((run) => run.datasetId === datasetId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const data = runs.map((run) => {
    const governed = hasGovernedQuality(run.quality);
    return {
      date: formatDate(run.createdAt),
      rows: run.rowCount,
      columns: run.columnCount,
      duplicates: run.duplicateRows,
      missing: Number(run.missingPercentage.toFixed(2)),
      memory: run.memoryUsageMB === undefined ? null : Number(run.memoryUsageMB.toFixed(3)),
      quality: governed ? Number(run.quality.overallScore.toFixed(2)) : null,
      compliance: governed ? Number(recordComplianceScore(run.quality).toFixed(2)) : null,
    };
  });

  if (!eligible.length) return <><PageHeader title="Profiling trends" description="Track factual profile and governed data-quality metrics over time." /><EmptyState title="No trend history yet" body="Save at least one profiling run to begin tracking changes." /></>;
  return <>
    <PageHeader title="Profiling trends" description="Track volume, structure, completeness, duplicates, memory, and governed quality across saved runs." />
    <div className="toolbar"><label className="field trend-dataset-select"><span>Data asset</span><select value={datasetId} onChange={(event) => setDatasetId(event.target.value)}>{eligible.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><div className="toolbar-summary">{runs.length} saved run{runs.length === 1 ? '' : 's'}</div></div>
    <div className="trend-grid">
      <TrendChart title="Row and column volume" description="Structural size after each completed profile" data={data} keys={[{ key: 'rows', label: 'Rows' }, { key: 'columns', label: 'Columns' }]} />
      <TrendChart title="Missingness and duplicates" description="Missing-cell percentage and exact duplicate row count" data={data} keys={[{ key: 'missing', label: 'Missing %' }, { key: 'duplicates', label: 'Duplicate rows' }]} />
      <TrendChart title="Overall Data Quality" description="Governed weighted quality score and records passing all active rules. Runs without governed rules appear as gaps." data={data} keys={[{ key: 'quality', label: 'Overall DQ %' }, { key: 'compliance', label: 'All-rules compliance %' }]} domain={[0, 100]} />
      <TrendChart title="Estimated serialized data size" description="Approximate UTF-8 size of the in-browser row representation" data={data} keys={[{ key: 'memory', label: 'Estimated MB' }]} />
    </div>
  </>;
}