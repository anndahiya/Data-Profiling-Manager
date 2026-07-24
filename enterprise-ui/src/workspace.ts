import { useCallback, useEffect, useState } from 'react';
import { db } from './db';
import { createDefaultDimensions } from './quality';
import { ensureWorkspaceSettings } from './retention';
import type { WorkspaceSnapshot } from './types';

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>({ datasets: [], runs: [], failures: [], issues: [], rules: [], dimensions: [], monitors: [], connections: [] });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (await db.dimensions.count() === 0) await db.dimensions.bulkPut(createDefaultDimensions());
    const settings = await ensureWorkspaceSettings();
    const [datasets, runs, failures, issues, rules, dimensions, monitors, connections] = await Promise.all([
      db.datasets.toArray(), db.runs.toArray(), db.failures.toArray(), db.issues.toArray(), db.rules.toArray(), db.dimensions.toArray(), db.monitors.toArray(), db.connections.toArray(),
    ]);
    setWorkspace({ datasets, runs, failures, issues, rules, dimensions, monitors, connections, settings });
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { workspace, loading, reload };
}
