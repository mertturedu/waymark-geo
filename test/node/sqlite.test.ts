import { mkdtempSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSqlite } from '../../src/node/sqlite';

function makeDb(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'sqlite-')), 'a.sqlite');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, data BLOB, n INTEGER)');
  db.prepare('INSERT INTO t (id, name, data, n) VALUES (?, ?, ?, ?)').run(1, 'Gül', Uint8Array.from([1, 2, 3]), 7);
  db.prepare('INSERT INTO t (id, name, data, n) VALUES (?, ?, ?, ?)').run(2, "O'Brien; DROP TABLE t; --", null, null);
  db.close();
  return path;
}

describe('openSqlite', () => {
  it('binds parameters and returns rows, blobs and nulls', async () => {
    const db = openSqlite(makeDb());
    expect(await db.all<{ name: string; data: Uint8Array; n: number }>('SELECT name, data, n FROM t WHERE id = ?', [1])).toEqual([{ name: 'Gül', data: Uint8Array.from([1, 2, 3]), n: 7 }]);
    expect(await db.all<{ data: null; n: null }>('SELECT data, n FROM t WHERE id = ?', [2])).toEqual([{ data: null, n: null }]);
    await db.close();
  });

  it('treats a hostile parameter as plain text', async () => {
    const db = openSqlite(makeDb());
    expect(await db.all('SELECT id FROM t WHERE name = ?', ["O'Brien; DROP TABLE t; --"])).toEqual([{ id: 2 }]);
    expect(await db.all('SELECT COUNT(*) AS n FROM t')).toEqual([{ n: 2 }]);
    await db.close();
  });

  it('takes a list of ids in one query', async () => {
    const db = openSqlite(makeDb());
    expect(await db.all('SELECT id FROM t WHERE id IN (?, ?) ORDER BY id', [1, 2])).toEqual([{ id: 1 }, { id: 2 }]);
    await db.close();
  });

  it('refuses writes', async () => {
    const db = openSqlite(makeDb());
    await expect(db.all('DELETE FROM t')).rejects.toThrow();
    await expect(db.all('INSERT INTO t (id) VALUES (9)')).rejects.toThrow();
    await db.close();
  });

  it('fails clearly after close and for a file that is not there', async () => {
    const db = openSqlite(makeDb());
    await db.close();
    await expect(db.all('SELECT 1')).rejects.toThrow();
    await db.close();
    expect(() => openSqlite('/yok/yok.sqlite')).toThrow();
  });

  it('turns a bad statement into a rejected promise', async () => {
    const db = openSqlite(makeDb());
    await expect(db.all('SELEKT nonsense')).rejects.toThrow();
    await db.close();
  });
});
