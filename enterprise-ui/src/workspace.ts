import { useCallback, useEffect, useState } from 'react';
import { db } from './db';
import { createDefaultDimensions } from './quality';
import type { WorkspaceSnapshot } from './types';

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>({ datasets: [], runs: [], issues: [], rules: [], dimensions: [], monitors: [] });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (await db.dimensions.count() === 0) await db.dimensions.bulkPut(createDefaultDimensions());
    const [datasets, runs, issues, rules, dimensions, monitors] = await Promise.all([
      db.datasets.toArray(),
      db.runs.toArray(),
      db.issues.toArray(),
      db.rules.toArray(),
      db.dimensions.toArray(),
      db.monitors.toArray(),
    ]);
    setWorkspace({ datasets, runs, issues, rules, dimensions, monitors });
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { workspace, loading, reload };
}