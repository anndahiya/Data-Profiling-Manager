import { useCallback, useEffect, useState } from 'react';
import { db } from './db';
import type { WorkspaceSnapshot } from './types';

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot>({ datasets: [], runs: [], issues: [], rules: [] });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const [datasets, runs, issues, rules] = await Promise.all([
      db.datasets.toArray(), db.runs.toArray(), db.issues.toArray(), db.rules.toArray(),
    ]);
    setWorkspace({ datasets, runs, issues, rules });
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  return { workspace, loading, reload };
}
