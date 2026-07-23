import { describe, expect, it } from 'vitest';
import { buildDatabaseScheduledWorkflow, connectorConfigJson, isReadOnlyQuery, normalizeSecretPrefix, requiredEnvironmentVariables } from './connections';
import type { DatabaseConnection, WorkspaceSnapshot } from './types';

function connection(): DatabaseConnection {
  return { id: 'customer-db', datasetId: 'customer', name: 'Customer DB', provider: 'PostgreSQL', host: 'db.internal', port: 5432, database: 'customer', schema: 'public', sslMode: 'require', secretPrefix: 'customer prod', query: 'SELECT * FROM public.customer', maxRows: 100000, enabled: true, createdAt: '', updatedAt: '' };
}

describe('database connection configuration', () => {
  it('accepts one read-only SELECT or CTE and rejects data-changing SQL', () => {
    expect(isReadOnlyQuery('SELECT * FROM customer')).toBe(true);
    expect(isReadOnlyQuery('WITH recent AS (SELECT * FROM customer) SELECT * FROM recent')).toBe(true);
    expect(isReadOnlyQuery('DELETE FROM customer')).toBe(false);
    expect(isReadOnlyQuery('SELECT * FROM customer; DROP TABLE customer')).toBe(false);
  });

  it('exports no usernames passwords or tokens', () => {
    const workspace: WorkspaceSnapshot = { datasets: [], runs: [], issues: [], rules: [], connections: [connection()] };
    const exported = connectorConfigJson(workspace);
    expect(exported).toContain('Customer DB');
    expect(exported).toContain('CUSTOMER_PROD');
    expect(exported).not.toContain('password');
    expect(exported).not.toContain('username');
    expect(exported).not.toContain('token');
  });

  it('generates explicit environment secret names and scheduled workflow mappings', () => {
    const item = connection();
    expect(normalizeSecretPrefix(item.secretPrefix)).toBe('CUSTOMER_PROD');
    expect(requiredEnvironmentVariables(item)).toEqual(['CUSTOMER_PROD_USER', 'CUSTOMER_PROD_PASSWORD']);
    const workspace: WorkspaceSnapshot = { datasets: [], runs: [], issues: [], rules: [], connections: [item], monitors: [{ id: 'monitor', datasetId: 'customer', enabled: true, sourcePath: 'connection:customer-db', recipientName: 'Steward', recipientEmail: 'steward@example.com', cadence: 'Monthly', weekday: 'Monday', dayOfMonth: 1, month: 1, hourUtc: 7, minute: 0, deliveryMode: 'breach-only', attachReport: true, aiSummary: false, createdAt: '', updatedAt: '' }] };
    const workflow = buildDatabaseScheduledWorkflow(workspace);
    expect(workflow).toContain('database_scheduled_agent.py');
    expect(workflow).toContain('CUSTOMER_PROD_USER: ${{ secrets.CUSTOMER_PROD_USER }}');
    expect(workflow).toContain('requirements-connectors.txt');
  });
});
