import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BellRing, BookOpenCheck, CalendarClock, CircleGauge, Columns3, Database, FileBarChart, History, Menu, Search, Settings, ShieldCheck, TrendingUp, TriangleAlert, UploadCloud, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { WorkspaceSnapshot } from './types';
import { formatDate } from './utils';

const navGroups = [
  { label: 'Workspace', items: [
    { path: '/overview', label: 'Overview', icon: CircleGauge },
    { path: '/assets', label: 'Data assets', icon: Database },
    { path: '/profile', label: 'Profile data', icon: UploadCloud },
    { path: '/connections', label: 'Database connections', icon: Database },
  ] },
  { label: 'Quality & observability', items: [
    { path: '/issues', label: 'Issues', icon: BellRing },
    { path: '/monitoring', label: 'Monitoring & schedules', icon: CalendarClock },
    { path: '/compare', label: 'Compare runs', icon: Columns3 },
    { path: '/trends', label: 'Profiling trends', icon: TrendingUp },
    { path: '/history', label: 'Run history', icon: History },
    { path: '/rules', label: 'Rules & dimensions', icon: BookOpenCheck },
  ] },
  { label: 'System', items: [{ path: '/settings', label: 'Settings', icon: Settings }] },
];

export function AppShell({ children, workspace }: { children: ReactNode; workspace: WorkspaceSnapshot }) {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState('');
  const openIssues = workspace.issues.filter((issue) => issue.status === 'Open').length;

  useEffect(() => {
    setMobileOpen(false);
    setQuery('');
    window.requestAnimationFrame(() => mainRef.current?.focus());
  }, [location.pathname]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMobileOpen(false); setQuery(''); } };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const assets = workspace.datasets.filter((dataset) => `${dataset.name} ${dataset.owner} ${dataset.description} ${dataset.tags.join(' ')}`.toLowerCase().includes(needle)).slice(0, 4).map((dataset) => ({ id: `asset-${dataset.id}`, path: `/assets/${dataset.id}`, type: 'Data asset', title: dataset.name, detail: dataset.owner || 'No owner', icon: Database }));
    const runs = workspace.runs.filter((run) => `${run.fileName} ${workspace.datasets.find((dataset) => dataset.id === run.datasetId)?.name ?? ''}`.toLowerCase().includes(needle)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4).map((run) => ({ id: `run-${run.id}`, path: `/runs/${run.id}`, type: 'Profiling run', title: run.fileName, detail: formatDate(run.createdAt), icon: FileBarChart }));
    const issues = workspace.issues.filter((issue) => `${issue.title} ${issue.description} ${issue.category} ${issue.status}`.toLowerCase().includes(needle)).slice(0, 4).map((issue) => ({ id: `issue-${issue.id}`, path: '/issues', type: issue.category, title: issue.title, detail: issue.status, icon: TriangleAlert }));
    const monitors = (workspace.monitors ?? []).filter((monitor) => `${workspace.datasets.find((dataset) => dataset.id === monitor.datasetId)?.name ?? ''} ${monitor.recipientName} ${monitor.recipientEmail} ${monitor.cadence}`.toLowerCase().includes(needle)).slice(0, 3).map((monitor) => ({ id: `monitor-${monitor.id}`, path: '/monitoring', type: 'Monitor', title: workspace.datasets.find((dataset) => dataset.id === monitor.datasetId)?.name ?? 'Monitoring policy', detail: `${monitor.cadence} · ${monitor.enabled ? 'Active' : 'Paused'}`, icon: CalendarClock }));
    const connections = (workspace.connections ?? []).filter((connection) => `${connection.name} ${connection.provider} ${connection.host} ${connection.database}`.toLowerCase().includes(needle)).slice(0, 3).map((connection) => ({ id: `connection-${connection.id}`, path: '/connections', type: 'Database connection', title: connection.name, detail: `${connection.provider} · ${connection.enabled ? 'Active' : 'Paused'}`, icon: Database }));
    return [...assets, ...connections, ...runs, ...issues, ...monitors].slice(0, 8);
  }, [query, workspace]);

  const searchOpen = query.trim().length >= 2;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <aside id="app-navigation" className={`sidebar ${mobileOpen ? 'open' : ''}`} aria-label="Primary navigation">
      <div className="brand-block"><div className="brand-mark">DP</div><div><strong>Data Profiling Manager</strong><span>Profile · Monitor · Compare</span></div></div>
      <nav className="nav-groups">{navGroups.map((group) => <section key={group.label} className="nav-group" aria-labelledby={`nav-${group.label.replace(/\W+/g, '-').toLowerCase()}`}><div id={`nav-${group.label.replace(/\W+/g, '-').toLowerCase()}`} className="nav-group-label">{group.label}</div>{group.items.map(({ path, label, icon: Icon }) => {
        const active = location.pathname === path || (path === '/assets' && location.pathname.startsWith('/assets/')) || (path === '/history' && location.pathname.startsWith('/runs/'));
        return <Link key={path} to={path} aria-current={active ? 'page' : undefined} className={`nav-link ${active ? 'active' : ''}`}><Icon size={17} /><span>{label}</span>{path === '/issues' && openIssues > 0 && <em aria-label={`${openIssues} open issues`}>{openIssues}</em>}</Link>;
      })}</section>)}</nav>
      <div className="sidebar-foot"><ShieldCheck size={16} /><span>Files stay in the browser. Database credentials stay on the local agent.</span></div>
    </aside>
    {mobileOpen && <button type="button" className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <main ref={mainRef} id="main-content" tabIndex={-1} className="main-shell">
      <header className="topbar">
        <button type="button" className="icon-button mobile-menu" onClick={() => setMobileOpen((open) => !open)} aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-controls="app-navigation" aria-expanded={mobileOpen}><Menu size={20} /><span>Menu</span></button>
        <div className="global-search">
          <label className="topbar-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets, connections, runs, issues, and monitors" aria-label="Search workspace" role="combobox" aria-expanded={searchOpen} aria-controls="workspace-search-results" aria-autocomplete="list" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}</label>
          {searchOpen && <div id="workspace-search-results" className="search-results" role="listbox" aria-label="Workspace search results">{results.length ? results.map(({ id, path, type, title, detail, icon: Icon }) => <Link role="option" aria-selected="false" key={id} to={path} onClick={() => setQuery('')}><span className="search-result-icon"><Icon size={15} /></span><span><b>{title}</b><small>{type} · {detail}</small></span></Link>) : <div className="search-no-results" role="status">No workspace items match “{query.trim()}”.</div>}</div>}
        </div>
        <div className="topbar-status"><span className="status-dot" /> Local browser workspace</div>
      </header>
      <div className="content-shell">{children}</div>
    </main>
  </div>;
}

export function LoadingScreen() {
  return <div className="loading-screen" role="status" aria-live="polite"><div className="brand-mark">DP</div><span>Opening your local workspace…</span></div>;
}
