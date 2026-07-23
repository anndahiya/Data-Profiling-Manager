import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, LoadingScreen } from './layout';
import { useWorkspace } from './workspace';
import { AssetDetailPage, AssetsPage } from './pages/AssetsPage';
import { ComparePage, HistoryPage } from './pages/HistoryComparePages';
import { IssuesPage, RulesPage } from './pages/IssuesRulesPages';
import { OverviewPage } from './pages/OverviewPage';
import { ProfilePage } from './pages/ProfilePage';
import { RunReportPage } from './pages/RunReportPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  const { workspace, loading, reload } = useWorkspace();
  if (loading) return <LoadingScreen />;
  return <AppShell workspace={workspace}><Routes>
    <Route path="/" element={<Navigate to="/overview" replace />} />
    <Route path="/overview" element={<OverviewPage workspace={workspace} />} />
    <Route path="/assets" element={<AssetsPage workspace={workspace} />} />
    <Route path="/assets/:datasetId" element={<AssetDetailPage workspace={workspace} />} />
    <Route path="/profile" element={<ProfilePage workspace={workspace} reload={reload} />} />
    <Route path="/runs/:runId" element={<RunReportPage workspace={workspace} />} />
    <Route path="/history" element={<HistoryPage workspace={workspace} reload={reload} />} />
    <Route path="/compare" element={<ComparePage workspace={workspace} />} />
    <Route path="/issues" element={<IssuesPage workspace={workspace} reload={reload} />} />
    <Route path="/rules" element={<RulesPage workspace={workspace} />} />
    <Route path="/settings" element={<SettingsPage workspace={workspace} reload={reload} />} />
    <Route path="*" element={<Navigate to="/overview" replace />} />
  </Routes></AppShell>;
}
