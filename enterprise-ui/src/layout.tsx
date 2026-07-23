import { useMemo, useState, type ReactNode } from 'react';
import { BellRing, BookOpenCheck, CircleGauge, Columns3, Database, FileBarChart, History, Menu, Search, Settings, ShieldCheck, TriangleAlert, UploadCloud, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { WorkspaceSnapshot } from './types';
import { formatDate } from './utils';

const navGroups = [
  { label: 'Workspace', items: [
    { path: '/overview', label: 'Overview', icon: CircleGauge },
    { path: '/assets', label: 'Data assets', icon: Database },
    { path: '/profile', label: 'Profile data', icon: UploadCloud },
  ] },
  { label: 'Quality & observability', items: [
    { path: '/issues', label: 'Issues', icon: BellRing },
    { path: '/compare', label: 'Compare runs', icon: Columns3 },
    { path: '/history', label: 'Run history', icon: History },
    { path: '/rules', label: 'Rules & dimensions', icon: BookOpenCheck },
  ] },
  { label: 'System', items: [{ path: '/settings', label: 'Settings', icon: Settings }] },
];

export function AppShell({ children, workspace }: { children: ReactNode; workspace: WorkspaceSnapshot }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const openIssues = workspace.issues.filter((issue) => issue.status === 'Open').length;
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const assets = workspace.datasets
      .filter((dataset) => `${dataset.name} ${dataset.owner} ${dataset.description} ${dataset.tags.join(' ')}`.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((dataset) => ({ id: `asset-${dataset.id}`, path: `/assets/${dataset.id}`, type: 'Data asset', title: dataset.name, detail: dataset.owner || 'No owner', icon: Database }));
    const runs = workspace.runs
      .filter((run) => `${run.fileName} ${workspace.datasets.find((dataset) => dataset.id === run.datasetId)?.name ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 4)
      .map((run) => ({ id: `run-${run.id}`, path: `/runs/${run.id}`, type: 'Profiling run', title: run.fileName, detail: formatDate(run.createdAt), icon: FileBarChart }));
    const issues = workspace.issues
      .filter((issue) => `${issue.title} ${issue.description} ${issue.category} ${issue.status}`.toLowerCase().includes(needle))
      .slice(0, 4)
      .map((issue) => ({ id: `issue-${issue.id}`, path: '/issues', type: issue.category, title: issue.title, detail: issue.status, icon: TriangleAlert }));
    return [...assets, ...runs, ...issues].slice(0, 8);
  }, [query, workspace]);

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand-block"><div className="brand-mark">DP</div><div><strong>Data Profiling Manager</strong><span>Profile · Monitor · Compare</span></div></div>
      <nav className="nav-groups">{navGroups.map((group) => <section key={group.label} className="nav-group">
        <div className="nav-group-label">{group.label}</div>
        {group.items.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path || (path === '/assets' && location.pathname.startsWith('/assets/')) || (path === '/history' && location.pathname.startsWith('/runs/'));
          return <Link key={path} to={path} className={`nav-link ${active ? 'active' : ''}`} onClick={() => setMobileOpen(false)}><Icon size={17} /><span>{label}</span>{path === '/issues' && openIssues > 0 && <em>{openIssues}</em>}</Link>;
        })}
      </section>)}</nav>
      <div className="sidebar-foot"><ShieldCheck size={16} /><span>Files are profiled in your browser. Raw rows are not uploaded by this web app.</span></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
    <main className="main-shell"><header className="topbar">
      <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
      <div className="global-search">
        <label className="topbar-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets, runs, and issues" aria-label="Search workspace" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
        {query.trim().length >= 2 && <div className="search-results">{results.length ? results.map(({ id, path, type, title, detail, icon: Icon }) => <Link key={id} to={path} onClick={() => setQuery('')}><span className="search-result-icon"><Icon size={15} /></span><span><b>{title}</b><small>{type} · {detail}</small></span></Link>) : <div className="search-no-results">No assets, runs, or issues match “{query.trim()}”.</div>}</div>}
      </div>
      <div className="topbar-status"><span className="status-dot" /> Local browser workspace</div>
    </header><div className="content-shell">{children}</div></main>
  </div>;
}

export function LoadingScreen() {
  return <div className="loading-screen"><div className="brand-mark">DP</div><span>Opening your local workspace…</span></div>;
}
