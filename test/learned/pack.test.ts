import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createLearnedLayer } from '../../src/core/learned/layer';
import { openLearned } from '../../src/core/learned/pack';
import { LEARNED_SCHEMA } from '../../src/core/learned/types';
import type { PackStore } from '../../src/core/ports';
import { openSqlite } from '../../src/node/sqlite';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'learned-pack-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function make(format: string | null, ranges = '[[0,1,3]]'): string {
  const file = join(dir, 'l.sqlite');
  const db = new DatabaseSync(file);
  for (const sql of LEARNED_SCHEMA) db.exec(sql);
  if (format) db.prepare('INSERT INTO meta VALUES (?, ?)').run('format', format);
  db.prepare('INSERT INTO door (key, lng, lat, trusted, sources, spread) VALUES (?, ?, ?, ?, ?, ?)').run('34|kadikoy|moda|gul~sokak|20', 29_000_000, 41_000_000, 1, 2, 4);
  db.prepare('INSERT INTO door (key, lng, lat, trusted, sources, spread) VALUES (?, ?, ?, ?, ?, ?)').run('34|kadikoy|moda|gul~sokak|3', 29_000_100, 41_000_000, 0, 1, 0);
  db.prepare('INSERT INTO door (key, lng, lat, trusted, sources, spread) VALUES (?, ?, ?, ?, ?, ?)').run('34|kadikoy|moda|gul~sokagi|5', 29_000_200, 41_000_000, 1, 1, 0);
  db.prepare('INSERT INTO door (key, lng, lat, trusted, sources, spread) VALUES (?, ?, ?, ?, ?, ?)').run('34|kadikoy|moda||5', 29_000_300, 41_000_000, 1, 1, 0);
  db.prepare('INSERT INTO layout VALUES (?, ?, ?, ?, ?, ?, ?)').run('k', 4, 0, 3, 100, 8, ranges);
  db.prepare('INSERT INTO entrance VALUES (?, ?, ?, ?, ?)').run('k', 1, 29_000_050, 41_000_000, 2);
  db.prepare('INSERT INTO entrance VALUES (?, ?, ?, ?, ?)').run('k', 0, 29_000_000, 41_000_000, 3);
  db.prepare('INSERT INTO hint (district, name, lng, lat, radius, sources) VALUES (?, ?, ?, ?, ?, ?)').run('kadikoy', 'Yeni Sokak', 29_000_000, 41_000_000, 60, 3);
  db.close();
  return file;
}

const key = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak', houseNumber: '20' };

describe('openLearned', () => {
  it('reads doors, neighbours and layouts', async () => {
    const db = openSqlite(make('1'));
    const pack = await openLearned(db);
    expect(await pack?.lookup(key)).toEqual({ coordinate: [29, 41], trusted: true });
    expect(await pack?.lookup({ ...key, houseNumber: '21' })).toBeNull();
    expect(await pack?.nearby({ region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak' })).toEqual([
      { int: 3, coordinate: [29.0001, 41], trusted: false },
      { int: 20, coordinate: [29, 41], trusted: true },
    ]);
    expect(await pack?.layout('k')).toMatchObject({ perFloor: 4, fit: 1, ranges: [[0, 1, 3]] });
    await db.close();
  });

  it('does not list doors of a neighbourhood without a street as neighbours of a street', async () => {
    const db = openSqlite(make('1'));
    const pack = await openLearned(db);
    expect(await pack?.nearby({ region: '34', district: 'kadikoy', neighbourhood: 'moda', street: '' })).toEqual([]);
    expect(await pack?.lookup({ ...key, street: '', houseNumber: '5' })).toEqual({ coordinate: [29.0003, 41], trusted: true });
    await db.close();
  });

  it('refuses a part from a newer format or without one', async () => {
    for (const format of ['2', null]) {
      const db = openSqlite(make(format));
      expect(await openLearned(db)).toBeNull();
      await db.close();
      rmSync(join(dir, 'l.sqlite'));
    }
  });

  it('reads entrances in order and street hints of a district', async () => {
    const db = openSqlite(make('1'));
    const pack = await openLearned(db);
    expect(await pack?.entrances('k')).toEqual([{ point: [29, 41], sources: 3 }, { point: [29.00005, 41], sources: 2 }]);
    expect(await pack?.entrances('yok')).toEqual([]);
    expect(await pack?.hints('kadikoy')).toEqual([{ district: 'kadikoy', name: 'Yeni Sokak', point: [29, 41], radiusM: 60, sources: 3 }]);
    expect(await pack?.hints('uskudar')).toEqual([]);
    await db.close();
  });

  it('survives layout ranges that are not a list of triples', async () => {
    for (const ranges of ['{"a":1}', '[[1,2]]', '[[1,2,"x"]]']) {
      const db = openSqlite(make('1', ranges));
      expect((await (await openLearned(db))?.layout('k'))?.ranges).toEqual([]);
      await db.close();
      rmSync(join(dir, 'l.sqlite'));
    }
  });

  it('refuses a database that has no meta table at all', async () => {
    const file = join(dir, 'empty.sqlite');
    new DatabaseSync(file).close();
    const db = openSqlite(file);
    expect(await openLearned(db)).toBeNull();
    await db.close();
  });

  it('survives damaged layout ranges', async () => {
    const db = openSqlite(make('1', 'not json'));
    expect((await (await openLearned(db))?.layout('k'))?.ranges).toEqual([]);
    await db.close();
  });
});

describe('createLearnedLayer', () => {
  it('answers for installed regions only and stays quiet otherwise', async () => {
    const db = openSqlite(make('1'));
    const store: PackStore = { installed: async () => ['34'], open: async () => null, openPart: async (region, kind) => (region === '34' && kind === 'learned' ? db : null) };
    const layer = createLearnedLayer(store);
    expect(await layer.lookup(key)).toMatchObject({ trusted: true });
    expect(await layer.lookup({ ...key, region: '06' })).toBeNull();
    expect(await layer.nearby?.({ region: '06', district: 'a', neighbourhood: '', street: 'b' })).toEqual([]);
    expect(await layer.layout?.('06', 'k')).toBeNull();
    expect(await layer.hints?.('06', 'kadikoy')).toEqual([]);
    expect(await layer.entrances?.('06', 'k')).toEqual([]);
    expect(await layer.entrances?.('34', 'yok')).toEqual([]);
    expect(await layer.entrances?.('34', 'k')).toEqual([[29, 41], [29.00005, 41]]);
    expect(await layer.hints?.('34', 'kadikoy')).toHaveLength(1);
    await db.close();
  });

  it('is silent when the store cannot open parts', async () => {
    const layer = createLearnedLayer({ installed: async () => [], open: async () => null });
    expect(await layer.lookup(key)).toBeNull();
  });
});
