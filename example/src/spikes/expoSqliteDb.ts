import type { SqlDb, SqlValue } from '../../../src/core/ports';

type ExpoDb = { getAllAsync(sql: string, params: SqlValue[]): Promise<unknown[]>; closeAsync(): Promise<void> };

export function expoSqlDb(db: ExpoDb): SqlDb {
  return {
    all: async <T>(sql: string, params: SqlValue[] = []) => (await db.getAllAsync(sql, params)) as T[],
    close: () => db.closeAsync(),
  };
}
