import { useState, type ReactNode } from 'react';
import { BellRing, BookOpenCheck, CircleGauge, Columns3, Database, History, Menu, Search, Settings, ShieldCheck, UploadCloud } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { WorkspaceSnapshot } from './types';

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
  const openIssues = workspace.issues.filter((issue) => issue.status === 'Open').length;
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
      <div className="topbar-search"><Search size={17} /><span>Search assets, runs, issues, and rules</span><kbd>⌘ K</kbd></div>
      <div className="topbar-status"><span className="status-dot" /> Local browser workspace</div>
    </header><div className="content-shell">{children}</div></main>
  </div>;
}

export function LoadingScreen() {
  return <div className="loading-screen"><div className="brand-mark">DP</div><span>Opening your local workspace…</span></div>;
}
