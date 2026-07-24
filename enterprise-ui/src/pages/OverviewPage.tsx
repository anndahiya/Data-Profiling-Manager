import { BellRing, Check, ChevronRight, Database, Plus, ShieldCheck, TableProperties, UploadCloud } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { AssetTable, EmptyState, MetricCard, PageHeader } from '../components';
import type { ProfileRun, WorkspaceSnapshot } from '../types';
import { CHART_COLORS, formatCompact, latestRunFor, weightedDimensions, weightedOverallQuality, workspaceQualityTrend } from '../utils';
import { LoadDemoButton } from './SettingsPage';

export function OverviewPage({ workspace }: { workspace: WorkspaceSnapshot }) {
  const navigate = useNavigate();
  const latestRuns = workspace.datasets.map((dataset) => latestRunFor(dataset.id, workspace.runs)).filter(Boolean) as ProfileRun[];
  const quality = weightedOverallQuality(workspace);
  const dimensions = weightedDimensions(workspace);
  const trend = workspaceQualityTrend(workspace).slice(-12);
  const openIssues = workspace.issues.filter((issue) => issue.status === 'Open');
  const categoryData = Object.entries(openIssues.reduce<Record<string, number>>((acc, issue) => ({ ...acc, [issue.category]: (acc[issue.category] ?? 0) + 1 }), {})).map(([name, value]) => ({ name, value }));

  if (!workspace.datasets.length) return <>
    <PageHeader title="Data health overview" description="Profile datasets, evaluate rules, detect change, and monitor issues from one workspace." />
    <EmptyState title="Your workspace is ready" body="Start with a real file, or load the demo workspace to explore the complete experience before profiling your own data." action={<div className="button-row"><button className="primary-button" onClick={() => navigate('/profile')}><UploadCloud size={17} /> Profile a dataset</button><LoadDemoButton /></div>} />
  </>;

  return <>
    <PageHeader title="Data health overview" description="A cross-dataset view of quality, observability, and recent activity." actions={<button className="primary-button" onClick={() => navigate('/profile')}><Plus size={17} /> New profile</button>} />
    <div className="metric-grid four">
      <MetricCard label="Overall quality" value={`${quality.toFixed(1)}%`} detail={`${latestRuns.reduce((sum, run) => sum + run.quality.rulesEvaluated, 0)} evaluated rules`} tone={quality >= 95 ? 'good' : 'warning'} icon={<ShieldCheck size={16} />} />
      <MetricCard label="Observed assets" value={String(workspace.datasets.length)} detail={`${workspace.runs.length} profiling runs`} icon={<Database size={16} />} />
      <MetricCard label="Open issues" value={String(openIssues.length)} detail={`${workspace.issues.filter((issue) => issue.severity === 'High' || issue.severity === 'Critical').length} high priority`} tone={openIssues.length ? 'bad' : 'good'} icon={<BellRing size={16} />} />
      <MetricCard label="Records evaluated" value={formatCompact(latestRuns.reduce((sum, run) => sum + run.rowCount, 0))} detail="Across latest dataset runs" icon={<TableProperties size={16} />} />
    </div>
    <div className="dashboard-grid">
      <section className="panel wide"><div className="panel-heading"><div><h2>Overall Data Quality trend</h2><p>Weighted overall score after each completed profiling run</p></div><button className="text-button" onClick={() => navigate('/compare')}>Compare runs <ChevronRight size={15} /></button></div><div className="chart-area"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend}><CartesianGrid stroke="#edf0f5" vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} tickLine={false} axisLine={false} /><Tooltip /><Line type="monotone" dataKey="quality" stroke="#5b5bd6" strokeWidth={3} dot={{ r: 4, fill: '#fff', strokeWidth: 2 }} /></LineChart></ResponsiveContainer></div></section>
      <section className="panel"><div className="panel-heading"><div><h2>Issue distribution</h2><p>Open issues by observability category</p></div></div>{categoryData.length ? <div className="donut-wrap"><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={86} paddingAngle={3}>{categoryData.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer><div className="donut-center"><b>{openIssues.length}</b><span>open</span></div></div> : <div className="mini-empty"><Check size={22} /><span>No open issues</span></div>}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Quality by dimension</h2><p>Weighted latest score across assets</p></div></div><div className="chart-area small"><ResponsiveContainer width="100%" height="100%"><BarChart data={dimensions} layout="vertical" margin={{ left: 12, right: 18 }}><CartesianGrid stroke="#edf0f5" horizontal={false} /><XAxis type="number" domain={[0, 100]} hide /><YAxis type="category" dataKey="dimension" width={88} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey="score" fill="#5b5bd6" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div></section>
      <section className="panel wide"><div className="panel-heading"><div><h2>Assets requiring attention</h2><p>Latest quality and issue status across the workspace</p></div><button className="text-button" onClick={() => navigate('/assets')}>View all assets <ChevronRight size={15} /></button></div><AssetTable workspace={workspace} compact /></section>
    </div>
  </>;
}
