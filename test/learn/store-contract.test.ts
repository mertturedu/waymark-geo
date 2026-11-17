import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqlLearnStore, type SqlRunner } from '../../src/core/learn/sql-store';
import { memoryStore, type LearnStore } from '../../src/core/learn/store';
import { fileStore } from '../../src/node/learn-store';

type Maker = { name: string; make: (dir: string, name: string) => LearnStore; persistent: boolean };

function nodeRunner(path: string): SqlRunner {
  const db = new DatabaseSync(path);
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params) {
      db.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: (string | number | null | Uint8Array)[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
  };
}

const shared = new Map<string, LearnStore>();

const makers: Maker[] = [
  { name: 'memoryStore', persistent: false, make: (_dir, name) => (shared.get(name) ?? (shared.set(name, memoryStore()), shared.get(name) as LearnStore)) },
  { name: 'fileStore', persistent: true, make: (dir, name) => fileStore(join(dir, `${name}.json`)) },
  { name: 'sqlLearnStore', persistent: true, make: (dir, name) => sqlLearnStore(nodeRunner(join(dir, `${name}.sqlite`))) },
];

describe.each(makers)('learn store contract: $name', ({ make, persistent }) => {
  let dir = '';
  let counter = 0;
  const fresh = (): string => `s${counter++}`;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'contract-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('starts empty', async () => {
    expect(await make(dir, fresh()).readAll()).toEqual([]);
  });

  it('returns rows sorted by key and replaces a value written twice', async () => {
    const store = make(dir, fresh());
    await store.write('b', '2');
    await store.write('a', '1');
    await store.write('b', '3');
    expect(await store.readAll()).toEqual([{ key: 'a', value: '1' }, { key: 'b', value: '3' }]);
  });

  it('removes a row and ignores a row that is not there', async () => {
    const store = make(dir, fresh());
    await store.write('a', '1');
    await store.remove('zzz');
    await store.remove('a');
    expect(await store.readAll()).toEqual([]);
  });

  it('keeps every write when many arrive at once', async () => {
    const store = make(dir, fresh());
    await Promise.all(Array.from({ length: 40 }, (_, i) => store.write(`k${String(i).padStart(2, '0')}`, String(i))));
    expect((await store.readAll()).map((r) => r.value)).toEqual(Array.from({ length: 40 }, (_, i) => String(i)));
  });

  it('keeps unicode keys, quotes and a large value intact', async () => {
    const store = make(dir, fresh());
    const big = 'ş'.repeat(200_000);
    await store.write("34|kadıköy|moda'|\"x\"~sokak|12/A", '{"a":"İ\\n"}');
    await store.write('big', big);
    const rows = await store.readAll();
    expect(rows.find((r) => r.key.startsWith('34|'))?.value).toBe('{"a":"İ\\n"}');
    expect(rows.find((r) => r.key === 'big')?.value).toBe(big);
  });

  it('keeps an empty value', async () => {
    const store = make(dir, fresh());
    await store.write('a', '');
    expect(await store.readAll()).toEqual([{ key: 'a', value: '' }]);
  });

  if (persistent) {
    it('gives the same rows after being opened again', async () => {
      const name = fresh();
      const first = make(dir, name);
      await first.write('a', '1');
      await first.write('b', '2');
      await first.remove('a');
      expect(await make(dir, name).readAll()).toEqual([{ key: 'b', value: '2' }]);
    });
  }
});

describe('sqlLearnStore', () => {
  it('creates its table once and not before the first use', async () => {
    const calls: string[] = [];
    const db = new DatabaseSync(':memory:');
    const runner: SqlRunner = {
      async exec(sql) {
        calls.push('exec');
        db.exec(sql);
      },
      async run(sql, params) {
        db.prepare(sql).run(...params);
      },
      async all<T>(sql: string, params: (string | number | null | Uint8Array)[] = []) {
        return db.prepare(sql).all(...params) as T[];
      },
    };
    const store = sqlLearnStore(runner);
    expect(calls).toEqual([]);
    await Promise.all([store.write('a', '1'), store.readAll(), store.remove('b')]);
    await store.readAll();
    expect(calls).toEqual(['exec']);
  });

  it('tries to create the table again after a failure', async () => {
    let attempts = 0;
    const db = new DatabaseSync(':memory:');
    const runner: SqlRunner = {
      async exec(sql) {
        if (++attempts === 1) throw new Error('locked');
        db.exec(sql);
      },
      async run(sql, params) {
        db.prepare(sql).run(...params);
      },
      async all<T>(sql: string, params: (string | number | null | Uint8Array)[] = []) {
        return db.prepare(sql).all(...params) as T[];
      },
    };
    const store = sqlLearnStore(runner);
    await expect(store.readAll()).rejects.toThrow('locked');
    expect(await store.readAll()).toEqual([]);
    expect(attempts).toBe(2);
  });
});

describe('sqlLearnStore close', () => {
  it('closes the runner and opens it again for the next use', async () => {
    const events: string[] = [];
    let rows: { key: string; value: string }[] = [];
    const runner: SqlRunner = {
      async exec() {
        events.push('exec');
      },
      async run(_sql, params) {
        rows = [{ key: String(params[0]), value: String(params[1]) }];
      },
      async all<T>() {
        return rows as unknown as T[];
      },
      async close() {
        events.push('close');
      },
    };
    const store = sqlLearnStore(runner);
    await store.write('a', '1');
    await store.close?.();
    await store.write('a', '2');
    expect(events).toEqual(['exec', 'close', 'exec']);
  });

  it('closes without a runner close', async () => {
    const runner: SqlRunner = { async exec() {}, async run() {}, async all<T>() { return [] as T[]; } };
    await expect(sqlLearnStore(runner).close?.()).resolves.toBeUndefined();
  });
});
