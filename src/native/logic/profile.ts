import type { SqlDb } from '../../core/ports';

export type ProfileTotals = { calls: number; ms: number; rows: number };

export function profileDb(now: () => number): { wrap(db: SqlDb): SqlDb; stats(): ProfileTotals; reset(): void } {
  let totals: ProfileTotals = { calls: 0, ms: 0, rows: 0 };
  return {
    wrap(db) {
      return {
        async all<T>(sql: string, params?: Parameters<SqlDb['all']>[1]): Promise<T[]> {
          const started = now();
          try {
            const rows = await db.all<T>(sql, params);
            totals.rows += rows.length;
            return rows;
          } finally {
            totals.calls += 1;
            totals.ms += now() - started;
          }
        },
        close: () => db.close(),
      };
    },
    stats: () => ({ ...totals }),
    reset() {
      totals = { calls: 0, ms: 0, rows: 0 };
    },
  };
}

export function summarizeProfile(totals: ProfileTotals, queries: number, totalMs: number): { callsPerQuery: number; sqlMsPerQuery: number; otherMsPerQuery: number; rowsPerQuery: number } {
  if (queries <= 0) return { callsPerQuery: 0, sqlMsPerQuery: 0, otherMsPerQuery: 0, rowsPerQuery: 0 };
  const sql = totals.ms / queries;
  return { callsPerQuery: totals.calls / queries, sqlMsPerQuery: sql, otherMsPerQuery: totalMs / queries - sql, rowsPerQuery: totals.rows / queries };
}
