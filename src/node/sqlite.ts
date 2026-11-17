import { DatabaseSync } from 'node:sqlite';
import type { SqlDb, SqlValue } from '../core/ports';

export function openSqlite(path: string): SqlDb {
  const db = new DatabaseSync(path, { readOnly: true });
  let open = true;
  return {
    async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      if (!open) throw new Error('database is closed');
      return db.prepare(sql).all(...params) as T[];
    },
    async close(): Promise<void> {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}
