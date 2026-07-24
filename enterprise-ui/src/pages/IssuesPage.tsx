import { useState } from 'react';
import { IssueTable, PageHeader } from '../components';
import { db } from '../db';
import type { Issue, IssueStatus, WorkspaceSnapshot } from '../types';

export function IssuesPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const [category, setCategory] = useState('All');
  const [status, setStatus] = useState<IssueStatus | 'All'>('Open');
  const filtered = workspace.issues
    .filter((issue) => (category === 'All' || issue.category === category) && (status === 'All' || issue.status === status))
    .sort((left, right) => (right.lastDetectedAt ?? right.createdAt).localeCompare(left.lastDetectedAt ?? left.createdAt));

  const updateStatus = async (issue: Issue, next: IssueStatus) => {
    const now = new Date().toISOString();
    await db.issues.update(issue.id, {
      status: next,
      resolvedAt: next === 'Resolved' || next === 'Closed' ? now : undefined,
      firstDetectedAt: issue.firstDetectedAt ?? issue.createdAt,
      lastDetectedAt: issue.lastDetectedAt ?? issue.createdAt,
      occurrenceCount: Math.max(1, issue.occurrenceCount ?? 1),
    });
    await reload();
  };

  return <>
    <PageHeader title="Issues" description="Track current findings and recurring occurrences without creating a duplicate issue on every run." />
    <div className="issue-summary" aria-label="Issue status filters">{(['Open', 'Acknowledged', 'Resolved', 'Closed'] as IssueStatus[]).map((item) => <button key={item} aria-pressed={status === item} className={status === item ? 'active' : ''} onClick={() => setStatus(item)}><span>{item}</span><strong>{workspace.issues.filter((issue) => issue.status === item).length}</strong></button>)}</div>
    <div className="toolbar"><div className="filter-pills" aria-label="Issue category filters">{['All', 'Data quality', 'Schema change', 'Record volume', 'Anomaly', 'Freshness'].map((item) => <button key={item} aria-pressed={category === item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><button className="text-button" onClick={() => setStatus('All')}>Show all statuses</button></div>
    <div className="toolbar-summary issue-filter-summary" aria-live="polite">{filtered.length} matching issue{filtered.length === 1 ? '' : 's'}</div>
    <IssueTable issues={filtered} onStatus={(issue, next) => void updateStatus(issue, next)} />
  </>;
}
