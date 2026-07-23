import { Download, ShieldCheck } from 'lucide-react';
import { qualityConfigJson } from '../monitoring';
import type { WorkspaceSnapshot } from '../types';
import { MonitoringPage } from './MonitoringPage';

function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function MonitoringWorkspacePage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const governedRules = workspace.rules.filter((rule) => rule.enabled);
  return <>
    <MonitoringPage workspace={workspace} reload={reload} />
    <section className="panel" style={{ marginTop: 16 }}>
      <div className="panel-heading"><div><h2>Governed quality configuration</h2><p>The scheduled Python agent uses this file to calculate the same weighted rule and dimension score as the browser. Export it again after changing rules, thresholds, dimensions, or weights.</p></div><ShieldCheck size={22} className="accent-icon" /></div>
      <div className="button-row"><button className="secondary-button" disabled={!governedRules.length} onClick={() => downloadText('quality_config.json', qualityConfigJson(workspace), 'application/json')}><Download size={16} /> Download quality_config.json</button><span className="category-chip">{governedRules.length} active governed rule{governedRules.length === 1 ? '' : 's'}</span></div>
      {!governedRules.length && <div className="alert warning" style={{ marginTop: 14 }}>Create or promote at least one governed rule before setting minimum overall-quality or strict-compliance thresholds for the scheduled agent.</div>}
      <ul className="check-list" style={{ marginTop: 16 }}><li>Commit this file beside schedule_config.csv for GitHub Actions, or keep both files beside the local runner.</li><li>Only rule definitions, weights, thresholds, and dimension metadata are exported. No source rows or database credentials are included.</li></ul>
    </section>
  </>;
}
