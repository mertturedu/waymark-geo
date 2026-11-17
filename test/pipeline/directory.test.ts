import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocator, lineThrough, loadModelGroups, medoid, buildDirectoryPack, type DirectoryRow } from '../../pipeline/build/directory';
import { baseAdmin, square } from './helpers/mini-work';

const row = (id: string, name: string, addr: string | null, lon: number, lat: number, extra: Partial<DirectoryRow> = {}): DirectoryRow => ({ id, name, name_tr: null, cat: 'grocery_store', g: 'market', conf: 0.9, addr, more: [], brand: null, tax: null, locality: null, postcode: null, lon, lat, ...extra });

async function build(rows: DirectoryRow[], modelGroups?: Record<string, string>, extra: DirectoryRow[] = []) {
  const work = mkdtempSync(join(tmpdir(), 'dir-'));
  mkdirSync(join(work, 'admin-pack'), { recursive: true });
  mkdirSync(join(work, 'overture'), { recursive: true });
  writeFileSync(join(work, 'admin-pack', '34.jsonl'), baseAdmin().map((a) => JSON.stringify(a)).join('\n') + '\n');
  writeFileSync(join(work, 'overture', '34.rows.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (extra.length > 0) {
    mkdirSync(join(work, 'fsq'), { recursive: true });
    writeFileSync(join(work, 'fsq', '34.rows.jsonl'), extra.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  const out = join(work, 'directory.sqlite');
  const stats = await buildDirectoryPack({ province: '34', workDir: work, outFile: out, osmTimestamp: 't', ...(modelGroups ? { modelGroups } : {}) });
  const db = new DatabaseSync(out, { readOnly: true });
  return { db, stats, work };
}
const all = <T>(db: DatabaseSync, sql: string): T[] => db.prepare(sql).all() as T[];

describe('createLocator', () => {
  const locator = createLocator(baseAdmin() as never);
  it('finds the district and the neighbourhood of a point', () => {
    expect(locator.locate(28.6, 40.7)).toEqual({ district: 'r10', neighbourhood: 'r20' });
  });
  it('gives a district without neighbourhood when no neighbourhood contains the point', () => {
    expect(locator.locate(28.9, 41.3)).toEqual({ district: 'r10', neighbourhood: null });
  });
  it('gives nothing outside every district', () => {
    expect(locator.locate(10, 10)).toBeNull();
  });
});

describe('medoid', () => {
  it('takes the point closest to all others', () => {
    expect(medoid([[0, 0], [0.0001, 0], [0.0002, 0], [0.5, 0.5]])).toEqual([0.0001, 0]);
  });
  it('takes the first of one or two points', () => {
    expect(medoid([[1, 1]])).toEqual([1, 1]);
    expect(medoid([[1, 1], [2, 2]])).toEqual([1, 1]);
  });
});

describe('lineThrough', () => {
  it('orders points along the street', () => {
    expect(lineThrough([[28.604, 40.7], [28.6, 40.7], [28.602, 40.7]])).toEqual([[[28.6, 40.7], [28.602, 40.7], [28.604, 40.7]]]);
  });
  it('splits at a gap and drops lone points and repeats', () => {
    const lines = lineThrough([[28.6, 40.7], [28.601, 40.7], [28.7, 40.7], [28.6, 40.7]]);
    expect(lines).toEqual([[[28.6, 40.7], [28.601, 40.7]]]);
    expect(lineThrough([[28.6, 40.7], [28.6, 40.7]])).toEqual([]);
  });
});

describe('buildDirectoryPack', () => {
  it('merges businesses at the same door into one door and keeps every business as a place', async () => {
    const { db, stats } = await build([
      row('a', 'Derya Market', 'Moda Mah. Gül Sokak No:5', 28.6, 40.7),
      row('b', 'Derya Şarküteri', 'Gül Sokak 5', 28.6003, 40.7003, { postcode: '34710' }),
      row('c', 'Dışarıda', 'Gül Sokak 5', 10, 10),
    ]);
    expect(stats).toMatchObject({ sourceRows: 3, located: 2, doorGroups: 1, places: 2 });
    expect(all<{ number: string; postcode: string | null }>(db, 'SELECT number, postcode FROM address')).toEqual([{ number: '5', postcode: '34710' }]);
    expect(all<{ name: string }>(db, 'SELECT name FROM poi ORDER BY id').map((p) => p.name).sort()).toEqual(['Derya Market', 'Derya Şarküteri']);
  });

  it('takes doors and streets from the second source without listing its businesses', async () => {
    const { db, stats } = await build(
      [row('a', 'Derya Market', 'Gül Sokak No:5', 28.6, 40.7)],
      undefined,
      [row('x', 'Evim', 'Gül Sokak No:5', 28.6002, 40.7002), row('y', 'Köşe Büfe', 'Lale Sokak No:9', 28.601, 40.701), row('z', 'Dışarıda', 'Lale Sokak 9', 10, 10)],
    );
    expect(stats).toMatchObject({ sourceRows: 1, extraRows: 3, located: 3, doorGroups: 2, places: 1 });
    expect(all<{ number: string }>(db, 'SELECT number FROM address ORDER BY number').map((a) => a.number)).toEqual(['5', '9']);
    expect(all<{ name: string }>(db, 'SELECT name FROM poi').map((p) => p.name)).toEqual(['Derya Market']);
  });

  it('keeps the point of a door the first source already has', async () => {
    const { db } = await build([row('a', 'Derya Market', 'Gül Sokak No:5', 28.6, 40.7)], undefined, [row('x', 'Bir', 'Gül Sokak No:5', 28.602, 40.702), row('y', 'İki', 'Gül Sokak No:5', 28.602, 40.702), row('z', 'Üç', 'Gül Sokak No:5', 28.602, 40.702)]);
    expect(all<{ lon: number; lat: number }>(db, 'SELECT lon, lat FROM address')).toEqual([{ lon: 28600000, lat: 40700000 }]);
  });

  it('keeps the street, door, category and brand of each business next to it', async () => {
    const { db } = await build([row('a', 'Derya Market', 'Gül Sokak No:5', 28.6, 40.7, { brand: 'Derya', cat: 'grocery_store', conf: 0.874, postcode: '34710' })]);
    expect(all(db, 'SELECT c.text AS cat, b.text AS brand, s.text AS street, i.number AS number, i.postcode AS postcode, i.conf AS conf FROM poi_info i LEFT JOIN info_text c ON c.id = i.cat LEFT JOIN info_text b ON b.id = i.brand LEFT JOIN info_text s ON s.id = i.street')).toEqual([{ cat: 'grocery_store', brand: 'Derya', street: 'Gül Sokak', number: '5', postcode: 34710, conf: 87 }]);
  });

  it('keeps a business without address text, with empty street and door', async () => {
    const { db } = await build([row('a', 'Hayalet Kafe', null, 28.6, 40.7, { conf: 0.35, g: 'food', cat: 'cafe' })]);
    expect(all(db, 'SELECT street, number, conf FROM poi_info')).toEqual([{ street: null, number: null, conf: 35 }]);
    expect(all(db, 'SELECT * FROM address')).toEqual([]);
  });

  it('uses every address of a business for doors and takes the one with a number for its details', async () => {
    const { db } = await build([row('a', 'Lale Lokantası', 'Bahariye Cd.', 28.6, 40.7, { more: ['Atatürk Sk. No:3'], g: 'food' })]);
    expect(all(db, 'SELECT s.text AS street, i.number AS number FROM poi_info i LEFT JOIN info_text s ON s.id = i.street')).toEqual([{ street: 'Atatürk Sokak', number: '3' }]);
    expect(all(db, 'SELECT n.name AS street, a.number FROM address a JOIN street_name n ON n.id = a.street_id')).toEqual([{ street: 'Atatürk Sokak', number: '3' }]);
    expect(all<{ name: string }>(db, 'SELECT name FROM street_name ORDER BY name').map((r) => r.name)).toEqual(['Atatürk Sokak']);
  });

  it('builds a street line from the points of businesses on it', async () => {
    const { db, stats } = await build([row('a', 'Bir', 'Gül Sokak No:1', 28.6, 40.7), row('b', 'İki', 'Gül Sokak No:3', 28.601, 40.7)]);
    expect(stats.parts).toBe(1);
    expect(all(db, 'SELECT COUNT(*) AS n FROM street_part')).toEqual([{ n: 1 }]);
  });

  it('writes the same bytes twice', async () => {
    const rows = [row('a', 'Bir', 'Gül Sokak No:1', 28.6, 40.7), row('b', 'İki', 'Gül Sokak No:3', 28.601, 40.7)];
    const first = await build(rows);
    const second = await build(rows);
    expect(first.stats.bytes).toBe(second.stats.bytes);
    expect(all(first.db, 'SELECT * FROM address')).toEqual(all(second.db, 'SELECT * FROM address'));
  });
});

void square;

describe('trigram index of the directory pack', () => {
  it('keeps the names of businesses apart from the names of streets', async () => {
    const { db } = await build([row('a', 'Derya Market', 'Gül Sokak No:5', 28.6, 40.7), row('b', 'Gülpark Cafe', 'Gül Sokak No:7', 28.601, 40.7, { g: 'food' })]);
    const street = all<{ id: number }>(db, "SELECT id FROM search_name WHERE kind = 0").map((r) => r.id);
    const place = all<{ id: number }>(db, "SELECT id FROM search_name WHERE kind = 1").map((r) => r.id);
    const { decodePostings } = await import('../../src/core/text/trigram');
    const used = (table: string): number[] => all<{ ids: Uint8Array }>(db, `SELECT ids FROM ${table}`).flatMap((r) => decodePostings(r.ids));
    expect([...new Set(used('tri'))].sort((a, b) => a - b)).toEqual(street.sort((a, b) => a - b));
    expect([...new Set(used('tri_poi'))].sort((a, b) => a - b)).toEqual(place.sort((a, b) => a - b));
  });
});

describe('model-assigned groups', () => {
  const rows = [row('a', 'Köşe Et Lokantası', null, 28.6, 40.7, { cat: 'steakhouse', g: 'other' }), row('b', 'Cem Avukatlık', null, 28.601, 40.7, { cat: 'attorney_or_law_firm', g: 'other' }), row('c', 'Derya Market', null, 28.602, 40.7)];

  it('moves a category of the rule list that fell into other to the group the model gave and marks it', async () => {
    const { db, stats } = await build(rows, { steakhouse: 'food', attorney_or_law_firm: 'other', yok_kategori: 'food' });
    const kinds = all<{ name: string; kind: string; msrc: number }>(db, 'SELECT p.name AS name, k.name AS kind, i.msrc AS msrc FROM poi p JOIN poi_kind k ON k.id = p.kind JOIN poi_info i ON i.id = p.id ORDER BY p.name');
    expect(kinds).toEqual([{ name: 'Cem Avukatlık', kind: 'other', msrc: 0 }, { name: 'Derya Market', kind: 'market', msrc: 0 }, { name: 'Köşe Et Lokantası', kind: 'food', msrc: 1 }]);
    expect(stats.modelKinds).toBe(1);
  });

  it('changes nothing without a model list, and reads the list from a file keeping only usable groups', async () => {
    const { db, stats } = await build(rows, {});
    expect(all<{ kind: string }>(db, 'SELECT k.name AS kind FROM poi p JOIN poi_kind k ON k.id = p.kind ORDER BY p.name').map((r) => r.kind)).toEqual(['other', 'market', 'other']);
    expect(stats.modelKinds).toBe(0);
    const file = join(mkdtempSync(join(tmpdir(), 'model-')), 'groups.json');
    writeFileSync(file, JSON.stringify({ groups: { steakhouse: 'food', mail: 'cargo', gym: 'other', park: 'zoo' } }));
    expect(loadModelGroups(file)).toEqual({ steakhouse: 'food' });
    expect(loadModelGroups(join(tmpdir(), 'yok.json'))).toEqual({});
    writeFileSync(file, '{}');
    expect(loadModelGroups(file)).toEqual({});
  });
});

describe('model-assigned groups in the reader', () => {
  it('keeps rule-based places ahead of model-assigned ones when a category browse is cut short, and tells which is which', async () => {
    const rows = [
      row('a', 'Klinik Aksoy', null, 28.6, 40.7, { cat: 'clinic', g: 'health', conf: 0.5 }),
      row('b', 'Psikolog Ece', null, 28.601, 40.7, { cat: 'psychology', g: 'other', conf: 0.99 }),
      row('c', 'Merkez Hastanesi', null, 28.602, 40.7, { cat: 'hospital', g: 'health', conf: 0.9 }),
    ];
    const { db, work } = await build(rows, { psychology: 'health' });
    db.close();
    const { openRegion } = await import('../../src/core/address/pack');
    const { openSqlite } = await import('../../src/node/sqlite');
    const sql = openSqlite(join(work, 'directory.sqlite'));
    const region = await openRegion(sql);
    const districts = region.districts.map((d) => d.id);
    const two = await region.poisInDistricts(['health'], districts, 2);
    expect(two.map((p) => p.name).sort()).toEqual(['Klinik Aksoy', 'Merkez Hastanesi']);
    const all = await region.poisInDistricts(['health'], districts, 10);
    expect(all.map((p) => [p.name, p.info?.model === true]).sort()).toEqual([['Klinik Aksoy', false], ['Merkez Hastanesi', false], ['Psikolog Ece', true]]);
    await sql.close();
  });
});
