import type { SqlValue } from '../ports';
import type { LearnStore, StoreRow } from './store';

export type SqlRunner = {
  exec(sql: string): Promise<void>;
  run(sql: string, params: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close?(): Promise<void>;
};

const CREATE = 'CREATE TABLE IF NOT EXISTS learned (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID';

export function sqlLearnStore(db: SqlRunner): LearnStore {
  let ready: Promise<void> | null = null;
  const prepare = (): Promise<void> => {
    if (!ready) {
      ready = db.exec(CREATE).catch((error) => {
        ready = null;
        throw error;
      });
    }
    return ready;
  };
  return {
    async readAll(): Promise<StoreRow[]> {
      await prepare();
      return db.all<StoreRow>('SELECT key, value FROM learned ORDER BY key');
    },
    async write(key, value) {
      await prepare();
      await db.run('INSERT OR REPLACE INTO learned (key, value) VALUES (?, ?)', [key, value]);
    },
    async remove(key) {
      await prepare();
      await db.run('DELETE FROM learned WHERE key = ?', [key]);
    },
    async close() {
      ready = null;
      await db.close?.();
    },
  };
}
