import type { ReactNode } from 'react';
import { ArrowLeft, Check, ChevronRight, Database, FileSearch, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DimensionResult, Issue, IssueStatus, ProfileRun, WorkspaceSnapshot } from './types';
import { formatDate, latestRunFor } from './utils';

export function PageHeader({ title, eyebrow, description, actions, backTo }: {
  title: string; eyebrow?: string; description?: string; actions?: ReactNode; backTo?: string;
}) {
  return <div className="page-header"><div className="page-title-wrap">
    {backTo && <Link className="back-link" to={backTo}><ArrowLeft size={16} /> Back</Link>}
    {eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}
  </div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><FileSearch size={26} /></div><h2>{title}</h2><p>{body}</p>{action}</div>;
}

export function MetricCard({ label, value, detail, tone = 'neutral', icon }: {
  label: string; value: string; detail?: string; tone?: string; icon?: ReactNode;
}) {
  return <div className={`metric-card ${tone}`}><div className="metric-label">{icon}{label}</div><div className="metric-value">{value}</div>{detail && <div className="metric-detail">{detail}</div>}</div>;
}

export function ScoreBadge({ score }: { score: number }) {
  const tone = score >= 95 ? 'good' : score >= 85 ? 'warning' : 'bad';
  return <span className={`score-badge ${tone}`}><span>{score.toFixed(1)}%</span></span>;
}

export function DimensionBars({ dimensions }: { dimensions: DimensionResult[] }) {
  return <div className="dimension-list">{dimensions.map((dimension) => <div className="dimension-row" key={dimension.dimension}>
    <div><strong>{dimension.dimension}</strong><span>{dimension.activeRules} active rule{dimension.activeRules === 1 ? '' : 's'}</span></div>
    <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(2, dimension.score)}%` }} /></div>
    <b>{dimension.score.toFixed(1)}%</b>
  </div>)}</div>;
}

export function AssetTable({ workspace, compact = false }: { workspace: WorkspaceSnapshot; compact?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Data asset</th><th>Latest run</th><th>Rows</th><th>Quality</th><th>Open issues</th><th /></tr></thead><tbody>
    {workspace.datasets.slice(0, compact ? 5 : undefined).map((dataset) => {
      const run = latestRunFor(dataset.id, workspace.runs);
      const issueCount = workspace.issues.filter((issue) => issue.datasetId === dataset.id && issue.status === 'Open').length;
      return <tr key={dataset.id}><td><div className="asset-cell"><div className="asset-icon"><Database size={17} /></div><div><Link to={`/assets/${dataset.id}`}>{dataset.name}</Link><span>{dataset.owner || 'No owner'} · {dataset.tags.join(', ') || 'No tags'}</span></div></div></td><td>{formatDate(run?.createdAt)}</td><td>{run ? run.rowCount.toLocaleString() : '—'}</td><td>{run ? <ScoreBadge score={run.quality.overallScore} /> : '—'}</td><td><span className={issueCount ? 'issue-count' : 'muted'}>{issueCount}</span></td><td><Link className="row-action" to={`/assets/${dataset.id}`} aria-label={`Open ${dataset.name}`}><ChevronRight size={17} /></Link></td></tr>;
    })}
  </tbody></table></div>;
}

export function RunList({ runs }: { runs: ProfileRun[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Run date</th><th>File</th><th>Rows</th><th>Quality</th><th /></tr></thead><tbody>
    {runs.map((run) => <tr key={run.id}><td>{formatDate(run.createdAt)}</td><td>{run.fileName}</td><td>{run.rowCount.toLocaleString()}</td><td><ScoreBadge score={run.quality.overallScore} /></td><td><Link className="row-action labeled" to={`/runs/${run.id}`}>Open <ChevronRight size={15} /></Link></td></tr>)}
  </tbody></table></div>;
}

const severityClass: Record<Issue['severity'], string> = { Critical: 'critical', High: 'high', Medium: 'medium', Low: 'low', Info: 'info' };

export function IssueTable({ issues, onStatus }: { issues: Issue[]; onStatus?: (issue: Issue, status: IssueStatus) => void }) {
  if (!issues.length) return <div className="mini-empty large"><Check size={24} /><span>No issues in this view</span></div>;
  return <div className="table-wrap"><table><thead><tr><th>Severity</th><th>Issue</th><th>Category</th><th>Status</th><th>Detected</th><th /></tr></thead><tbody>
    {issues.map((issue) => <tr key={issue.id}><td><span className={`severity-dot ${severityClass[issue.severity]}`} />{issue.severity}</td><td><strong>{issue.title}</strong><span className="cell-subtitle">{issue.description}</span></td><td><span className="category-chip">{issue.category}</span></td><td><span className={`status-chip ${issue.status.toLowerCase()}`}>{issue.status}</span></td><td>{formatDate(issue.createdAt)}</td><td>{onStatus && <select className="inline-select" value={issue.status} onChange={(event) => onStatus(issue, event.target.value as IssueStatus)}><option>Open</option><option>Acknowledged</option><option>Resolved</option><option>Closed</option></select>}</td></tr>)}
  </tbody></table></div>;
}

export function PrivacyBadge() {
  return <div className="privacy-note"><ShieldCheck size={17} /><div><strong>Private by default</strong><span>Only aggregate profiles, DQ results, and issues are stored in IndexedDB.</span></div></div>;
}
