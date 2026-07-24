import { useState } from 'react';
import { Database, Download, Pencil, Plus, Power, ShieldCheck, Trash2, X } from 'lucide-react';
import { PageHeader } from '../components';
import { connectorConfigJson, defaultDatabasePort, isReadOnlyQuery, normalizeSecretPrefix, requiredEnvironmentVariables } from '../connections';
import { db } from '../db';
import type { DatabaseConnection, DatabaseProvider, Dataset, WorkspaceSnapshot } from '../types';

function downloadText(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

export function ConnectionsPage({ workspace, reload }: { workspace: WorkspaceSnapshot; reload: () => Promise<void> }) {
  const connections = (workspace.connections ?? []).sort((a, b) => a.name.localeCompare(b.name));
  const [editing, setEditing] = useState<DatabaseConnection | 'new' | null>(null);
  const save = async (connection: DatabaseConnection, dataset?: Dataset) => {
    await db.transaction('rw', [db.connections, db.datasets], async () => {
      if (dataset) await db.datasets.put(dataset);
      await db.connections.put(connection);
      const existing = dataset ?? workspace.datasets.find((item) => item.id === connection.datasetId);
      if (existing) await db.datasets.put({ ...existing, source: { mode: 'database', displayName: connection.name, connectorType: connection.provider, connectionId: connection.id }, updatedAt: connection.updatedAt });
    });
    setEditing(null); await reload();
  };
  const toggle = async (connection: DatabaseConnection) => { await db.connections.update(connection.id, { enabled: !connection.enabled, updatedAt: new Date().toISOString() }); await reload(); };
  const remove = async (connection: DatabaseConnection) => {
    const reference = `connection:${connection.id}`;
    const linkedMonitors = (workspace.monitors ?? []).filter((monitor) => monitor.sourcePath === reference);
    const message = linkedMonitors.length
      ? `Delete the metadata for “${connection.name}” and remove ${linkedMonitors.length} monitor${linkedMonitors.length === 1 ? '' : 's'} that depend on it? No database credentials are stored here.`
      : `Delete the metadata for “${connection.name}”? No database credentials are stored here.`;
    if (!window.confirm(message)) return;
    await db.transaction('rw', [db.connections, db.datasets, db.monitors], async () => {
      await db.connections.delete(connection.id);
      const dataset = workspace.datasets.find((item) => item.id === connection.datasetId);
      if (dataset?.source?.connectionId === connection.id) await db.datasets.update(dataset.id, { source: { mode: 'manual-upload' }, updatedAt: new Date().toISOString() });
      await Promise.all(linkedMonitors.map((monitor) => db.monitors.delete(monitor.id)));
    });
    await reload();
  };
  const active = connections.filter((connection) => connection.enabled);
  return <>
    <PageHeader title="Database connections" description="Register read-only database sources for the local profiling agent. The public browser stores connection metadata and SQL only—never usernames, passwords, private keys, or tokens." actions={<button className="primary-button" onClick={() => setEditing('new')}><Plus size={16} /> Add connection</button>} />
    <div className="alert warning"><ShieldCheck size={17} /><span>Database queries do not run from Cloudflare. Export connector_config.json and run the local agent inside the network that can reach the database. Use a read-only database account with access limited to the intended objects.</span></div>
    <section className="panel" style={{ marginBottom: 16 }}><div className="panel-heading"><div><h2>Local-agent connector file</h2><p>Export after every connection or query change. Credentials are resolved from environment variables on the machine running the agent.</p></div></div><div className="button-row"><button className="secondary-button" disabled={!active.length} onClick={() => downloadText('connector_config.json', connectorConfigJson(workspace))}><Download size={16} /> Download connector_config.json</button><span className="category-chip">{active.length} active connection{active.length === 1 ? '' : 's'}</span></div></section>
    {connections.length ? <div className="settings-grid">{connections.map((connection) => {
      const dataset = workspace.datasets.find((item) => item.id === connection.datasetId);
      const env = requiredEnvironmentVariables(connection);
      return <section className="panel" key={connection.id}><div className="panel-heading"><div><h2>{connection.name}</h2><p>{connection.provider} · {dataset?.name ?? 'Unlinked asset'}</p></div><span className={`status-chip ${connection.enabled ? 'resolved' : 'closed'}`}>{connection.enabled ? 'Active' : 'Paused'}</span></div><dl className="detail-list"><div><dt>Host</dt><dd>{connection.host}:{connection.port}</dd></div><div><dt>Database</dt><dd>{connection.database || 'Not required'}</dd></div>{connection.schema && <div><dt>Schema</dt><dd>{connection.schema}</dd></div>}<div><dt>Agent source reference</dt><dd><code>connection:{connection.id}</code></dd></div><div><dt>Maximum rows</dt><dd>{connection.maxRows.toLocaleString()}</dd></div></dl><div className="inspector-section"><h4>Required environment secrets</h4>{env.map((item) => <div className="pattern-row" key={item}><code>{item}</code><span>Set on agent</span></div>)}</div><div className="button-row"><button className="small-button" onClick={() => void toggle(connection)}><Power size={14} /> {connection.enabled ? 'Pause' : 'Enable'}</button><button className="small-button" onClick={() => setEditing(connection)}><Pencil size={14} /> Edit</button><button className="small-button" onClick={() => void remove(connection)}><Trash2 size={14} /> Delete</button></div></section>;
    })}</div> : <section className="empty-state"><div className="empty-icon"><Database size={25} /></div><h2>No database connections yet</h2><p>Add PostgreSQL, Supabase, Snowflake, or DB2 metadata and a read-only query. Credentials remain on the local runner.</p><button className="primary-button" onClick={() => setEditing('new')}><Plus size={16} /> Add first connection</button></section>}
    {editing && <ConnectionEditor value={editing === 'new' ? undefined : editing} workspace={workspace} onCancel={() => setEditing(null)} onSave={(connection, dataset) => void save(connection, dataset)} />}
  </>;
}

function ConnectionEditor({ value, workspace, onCancel, onSave }: { value?: DatabaseConnection; workspace: WorkspaceSnapshot; onCancel: () => void; onSave: (connection: DatabaseConnection, dataset?: Dataset) => void }) {
  const [datasetId, setDatasetId] = useState(value?.datasetId ?? 'new');
  const [assetName, setAssetName] = useState('');
  const [owner, setOwner] = useState('');
  const [name, setName] = useState(value?.name ?? '');
  const [provider, setProvider] = useState<DatabaseProvider>(value?.provider ?? 'PostgreSQL');
  const [host, setHost] = useState(value?.host ?? '');
  const [port, setPort] = useState(value?.port ?? 5432);
  const [database, setDatabase] = useState(value?.database ?? '');
  const [schema, setSchema] = useState(value?.schema ?? '');
  const [account, setAccount] = useState(value?.account ?? '');
  const [warehouse, setWarehouse] = useState(value?.warehouse ?? '');
  const [role, setRole] = useState(value?.role ?? '');
  const [sslMode, setSslMode] = useState<'require' | 'prefer' | 'disable'>(value?.sslMode ?? (provider === 'Supabase' ? 'require' : 'prefer'));
  const [secretPrefix, setSecretPrefix] = useState(value?.secretPrefix ?? 'DPM_DATABASE');
  const [query, setQuery] = useState(value?.query ?? 'SELECT * FROM schema_name.table_name');
  const [maxRows, setMaxRows] = useState(value?.maxRows ?? 100000);
  const [enabled, setEnabled] = useState(value?.enabled ?? true);
  const queryValid = isReadOnlyQuery(query);
  const submit = () => {
    const targetId = datasetId === 'new' ? crypto.randomUUID() : datasetId;
    if (!name.trim() || !host.trim() || !queryValid || !targetId || (datasetId === 'new' && !assetName.trim())) return;
    const now = new Date().toISOString();
    const connection: DatabaseConnection = { id: value?.id ?? crypto.randomUUID(), datasetId: targetId, name: name.trim(), provider, host: host.trim(), port, database: database.trim(), schema: schema.trim() || undefined, account: account.trim() || undefined, warehouse: warehouse.trim() || undefined, role: role.trim() || undefined, sslMode, secretPrefix: normalizeSecretPrefix(secretPrefix), query: query.trim(), maxRows: Math.max(1, Math.min(5_000_000, maxRows)), enabled, createdAt: value?.createdAt ?? now, updatedAt: now };
    const dataset = datasetId === 'new' ? { id: targetId, name: assetName.trim(), owner: owner.trim(), description: `Database asset using ${provider}`, tags: ['Database'], createdAt: now, updatedAt: now, source: { mode: 'database' as const, displayName: connection.name, connectorType: provider, connectionId: connection.id } } : undefined;
    onSave(connection, dataset);
  };
  return <div className="modal-backdrop"><div className="modal-card"><button className="modal-close" onClick={onCancel}><X size={18} /></button><h2>{value ? 'Edit database connection' : 'Add database connection'}</h2><p>Only non-secret metadata is saved here. The agent reads credentials from environment variables derived from the secret prefix.</p><div className="field-grid"><label className="field"><span>Data asset</span><select value={datasetId} disabled={Boolean(value)} onChange={(event) => setDatasetId(event.target.value)}><option value="new">Create a new data asset</option>{workspace.datasets.map((dataset) => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><label className="field"><span>Connection name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Production customer database" /></label></div>{datasetId === 'new' && <div className="field-grid"><label className="field"><span>New asset name</span><input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Customer master" /></label><label className="field"><span>Owner / steward</span><input value={owner} onChange={(event) => setOwner(event.target.value)} /></label></div>}<div className="field-grid"><label className="field"><span>Provider</span><select value={provider} onChange={(event) => { const next = event.target.value as DatabaseProvider; setProvider(next); setPort(defaultDatabasePort(next)); if (next === 'Supabase') setSslMode('require'); }}><option>PostgreSQL</option><option>Supabase</option><option>Snowflake</option><option>DB2</option></select></label><label className="field"><span>Status</span><select value={enabled ? 'enabled' : 'paused'} onChange={(event) => setEnabled(event.target.value === 'enabled')}><option value="enabled">Enabled</option><option value="paused">Paused</option></select></label></div><div className="field-grid"><label className="field"><span>{provider === 'Snowflake' ? 'Account host' : 'Host'}</span><input value={host} onChange={(event) => setHost(event.target.value)} placeholder={provider === 'Supabase' ? 'db.project-ref.supabase.co' : 'database.company.com'} /></label><label className="field"><span>Port</span><input type="number" value={port} onChange={(event) => setPort(Number(event.target.value))} /></label></div><div className="field-grid"><label className="field"><span>Database</span><input value={database} onChange={(event) => setDatabase(event.target.value)} /></label><label className="field"><span>Schema</span><input value={schema} onChange={(event) => setSchema(event.target.value)} /></label></div>{provider === 'Snowflake' && <div className="field-grid"><label className="field"><span>Warehouse</span><input value={warehouse} onChange={(event) => setWarehouse(event.target.value)} /></label><label className="field"><span>Role</span><input value={role} onChange={(event) => setRole(event.target.value)} /></label></div>}<div className="field-grid"><label className="field"><span>Secret prefix</span><input value={secretPrefix} onChange={(event) => setSecretPrefix(event.target.value)} /><small>Agent expects {normalizeSecretPrefix(secretPrefix)}_USER and {normalizeSecretPrefix(secretPrefix)}_PASSWORD.</small></label><label className="field"><span>SSL mode</span><select value={sslMode} onChange={(event) => setSslMode(event.target.value as 'require' | 'prefer' | 'disable')}><option value="require">Require</option><option value="prefer">Prefer</option><option value="disable">Disable</option></select></label></div><label className="field"><span>Read-only SQL query</span><textarea value={query} onChange={(event) => setQuery(event.target.value)} style={{ minHeight: 150 }} /><small>{queryValid ? 'Read-only query format accepted. Database permissions remain the primary control.' : 'Query must begin with SELECT or WITH and cannot contain data-changing statements or multiple statements.'}</small></label><label className="field"><span>Maximum rows returned</span><input type="number" min="1" max="5000000" value={maxRows} onChange={(event) => setMaxRows(Number(event.target.value))} /></label><div className="modal-actions"><button className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button" disabled={!name.trim() || !host.trim() || !queryValid || (datasetId === 'new' && !assetName.trim())} onClick={submit}>Save connection</button></div></div></div>;
}