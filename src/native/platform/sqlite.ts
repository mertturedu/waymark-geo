import { Directory } from 'expo-file-system';
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { SqlDb, SqlValue } from '../../core/ports';
import type { SqlRunner } from '../../core/learn/sql-store';

export function splitFileUri(uri: string): { dir: string; name: string } {
  const path = decodeURI(uri.replace(/^file:\/\//, ''));
  const at = path.lastIndexOf('/');
  return { dir: path.slice(0, at), name: path.slice(at + 1) };
}

export function wrapDatabase(db: SQLiteDatabase): SqlDb {
  return {
    all: async <T>(sql: string, params: SqlValue[] = []) => (await db.getAllAsync(sql, params)) as T[],
    close: () => db.closeAsync(),
  };
}

export function createExpoOpener(root: Directory): (path: string) => Promise<SqlDb> {
  return async (path) => {
    const { dir, name } = splitFileUri(`${root.uri}${path}`);
    return wrapDatabase(await openDatabaseAsync(name, { useNewConnection: true }, dir));
  };
}

export function createExpoRunner(root: Directory, file: string): SqlRunner {
  let opened: Promise<SQLiteDatabase> | null = null;
  const database = (): Promise<SQLiteDatabase> => {
    if (!opened) {
      const { dir, name } = splitFileUri(`${root.uri}${file}`);
      opened = openDatabaseAsync(name, undefined, dir).catch((error) => {
        opened = null;
        throw error;
      });
    }
    return opened;
  };
  return {
    async exec(sql) {
      await (await database()).execAsync(sql);
    },
    async run(sql, params) {
      await (await database()).runAsync(sql, params);
    },
    all: async <T>(sql: string, params: SqlValue[] = []) => (await (await database()).getAllAsync(sql, params)) as T[],
    async close() {
      const current = opened;
      opened = null;
      if (current) await (await current).closeAsync();
    },
  };
}
