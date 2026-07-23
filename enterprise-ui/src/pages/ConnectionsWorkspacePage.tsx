import { Download, ServerCog } from 'lucide-react';
import { buildDatabaseScheduledWorkflow } from '../connections';
import type { WorkspaceSnapshot } from '../types';
import { ConnectionsPage } from './ConnectionsPage';

function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/yaml' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export function ConnectionsWorkspacePage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const active = (workspace.connections ?? []).filter((connection) => connection.enabled);
  return <>
    <ConnectionsPage workspace={workspace} reload={reload} />
    <section className="panel" style={{ marginTop: 16 }}><div className="panel-heading"><div><h2>Scheduled database runner</h2><p>Use the database-specific workflow when monitor sources use connection:&lt;id&gt;. Private databases normally require a self-hosted GitHub runner or a local scheduler inside the company network.</p></div><ServerCog size={22} className="accent-icon" /></div><button className="secondary-button" disabled={!active.length} onClick={() => downloadText('scheduled-database-profiling.yml', buildDatabaseScheduledWorkflow(workspace))}><Download size={16} /> Download database workflow</button><ul className="check-list" style={{ marginTop: 16 }}><li>Install both requirements.txt and requirements-connectors.txt.</li><li>Set each generated USER and PASSWORD environment variable plus the SMTP secrets used for steward alerts.</li><li>For source freshness, use a governed freshness rule on a database timestamp column; filesystem modified-time thresholds do not represent database currency.</li></ul></section>
  </>;
}
