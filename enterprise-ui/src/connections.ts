import type { DatabaseConnection, DatabaseProvider, WorkspaceSnapshot } from './types';

export function defaultDatabasePort(provider: DatabaseProvider): number {
  if (provider === 'DB2') return 50000;
  if (provider === 'Snowflake') return 443;
  return 5432;
}

export function normalizeSecretPrefix(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'DPM_DATABASE';
}

export function requiredEnvironmentVariables(connection: DatabaseConnection): string[] {
  const prefix = normalizeSecretPrefix(connection.secretPrefix);
  return [`${prefix}_USER`, `${prefix}_PASSWORD`];
}

export function isReadOnlyQuery(query: string): boolean {
  const stripped = query.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/^(select|with)\b/i.test(stripped)) return false;
  const withoutTrailingSemicolon = stripped.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) return false;
  return !/\b(insert|update|delete|drop|alter|create|truncate|merge|call|execute|grant|revoke|copy|put|remove)\b/i.test(withoutTrailingSemicolon);
}

export function connectorConfigJson(workspace: WorkspaceSnapshot): string {
  return JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    connections: (workspace.connections ?? []).filter((connection) => connection.enabled).map(({ id, datasetId, name, provider, host, port, database, schema, account, warehouse, role, sslMode, secretPrefix, query, maxRows, enabled }) => ({
      id, datasetId, name, provider, host, port, database, schema, account, warehouse, role, sslMode, secretPrefix: normalizeSecretPrefix(secretPrefix), query, maxRows, enabled,
    })),
  }, null, 2);
}
