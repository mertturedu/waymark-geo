import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { address, baseAdmin, baseRows, part, where, writeWork, type Rows } from './helpers/mini-work';
import { APPLICATION_ID, FORMAT_VERSION, buildAddressPack, cleanNeighbourhoodName } from '../../pipeline/build/address-pack';
import { cellOf, cellsOfLine } from '../../src/core/geo/cells';
import { decodeLines, decodeRings, pointInRings } from '../../src/core/region/geom';
import { nameKey } from '../../src/core/text/fold';
import { streetKey } from '../../src/core/text/street';
import { decodePostings, trigramCodes } from '../../src/core/text/trigram';

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex');
const open = (path: string): DatabaseSync => new DatabaseSync(path, { readOnly: true });
const all = <T>(db: DatabaseSync, sql: string, ...params: (string | number)[]): T[] => db.prepare(sql).all(...params) as T[];

async function build(rows: Rows, name = 'pack.sqlite') {
  const dir = writeWork(rows);
  const outFile = join(dir, name);
  const stats = await buildAddressPack({ province: '34', workDir: dir, outFile, osmTimestamp: '2026-10-20T20:23:47Z' });
  return { dir, outFile, stats, db: open(outFile) };
}

describe('cleanNeighbourhoodName', () => {
  it.each([['Moda Mahallesi', 'Moda'], ['Fener Mah.', 'Fener'], ['Yeni Mh', 'Yeni'], ['Mahallesi', 'Mahallesi'], ['Bahariye', 'Bahariye'], ['  Cumhuriyet   Mahallesi ', 'Cumhuriyet']])('%j becomes %j', (raw, clean) => {
    expect(cleanNeighbourhoodName(raw)).toBe(clean);
  });
});

describe('buildAddressPack', () => {
  it('writes every accepted address once with its number fields', async () => {
    const { db, stats } = await build(baseRows());
    expect(stats.rows).toBe(8);
    const rows = all<{ number: string; nkey: string; num: number | null; suffix: string; parity: number | null; lon: number; lat: number; osm: number }>(db, 'SELECT * FROM address ORDER BY id');
    expect(rows).toHaveLength(8);
    const slash = rows.find((r) => r.number === '3/A');
    expect(slash).toMatchObject({ nkey: '3/a', num: 3, suffix: '/a', parity: 1, lon: 28_620_000, lat: 40_720_000, osm: 7 * 4 });
    expect(rows.find((r) => r.number === '٣٤')).toMatchObject({ nkey: '34', num: 34, parity: 0 });
  });

  it('keeps an address with no street and gives it no street id', async () => {
    const { db } = await build(baseRows());
    expect(all<{ street_id: number | null; hood_id: number }>(db, "SELECT street_id, hood_id FROM address WHERE number = '7'")).toEqual([{ street_id: null, hood_id: 1 }]);
  });

  it('turns two spellings of one street into one name row and different street words into different rows', async () => {
    const { db } = await build(baseRows());
    const names = all<{ name: string; key: string; kind: string | null }>(db, 'SELECT name, key, kind FROM street_name ORDER BY id');
    expect(names.map((n) => `${n.key}/${n.kind}`)).toEqual(['ataturk/cadde', 'ataturk/sokak', 'bahariye/cadde', 'gul/sokak']);
    const bahariye = all<{ street_id: number }>(db, "SELECT street_id FROM address WHERE number IN ('14', '16') AND hood_id = 1 AND street_id = 3");
    expect(bahariye).toHaveLength(2);
    expect(names.find((n) => n.key === 'bahariye')?.name).toBe('Bahariye Caddesi');
  });

  it('keeps one name row but separate parts and separate addresses for the same street in two neighbourhoods', async () => {
    const { db } = await build(baseRows());
    expect(all(db, "SELECT id FROM street_name WHERE key = 'gul'")).toHaveLength(1);
    const parts = all<{ district_id: number; hood_id: number }>(db, "SELECT p.district_id, p.hood_id FROM street_part p JOIN street_name n ON n.id = p.name_id WHERE n.key = 'gul' ORDER BY p.id");
    expect(parts).toEqual([{ district_id: 1, hood_id: 1 }, { district_id: 2, hood_id: 2 }]);
    const doors = all<{ number: string; district_id: number; hood_id: number }>(db, "SELECT a.number, a.district_id, a.hood_id FROM address a JOIN street_name n ON n.id = a.street_id WHERE n.key = 'gul' ORDER BY a.id");
    expect(doors).toEqual([{ number: '14', district_id: 1, hood_id: 1 }, { number: '12', district_id: 2, hood_id: 2 }]);
  });

  it('stores every line of a part and its ways in one geometry blob', async () => {
    const { db } = await build(baseRows());
    const row = all<{ geom: Uint8Array }>(db, "SELECT p.geom FROM street_part p JOIN street_name n ON n.id = p.name_id WHERE n.key = 'ataturk' AND n.kind = 'cadde'")[0];
    expect(decodeLines(row?.geom as Uint8Array)).toEqual([[[28.6, 40.8], [28.7, 40.8]], [[28.6, 40.81], [28.7, 40.81]]]);
  });

  it('strips the neighbourhood word and makes a place for a name only found in a tag, reusing one that already exists', async () => {
    const { db, stats } = await build(baseRows());
    const hoods = all<{ id: number; name: string; key: string; source: number; cx: number | null; poly: Uint8Array | null; district_id: number }>(db, 'SELECT id, name, key, source, cx, poly, district_id FROM neighbourhood ORDER BY id');
    expect(hoods.map((h) => [h.name, h.source, h.district_id])).toEqual([['Moda', 0, 1], ['Fener', 0, 2], ['Bahariye', 1, 1]]);
    expect(hoods[2]?.poly).toBeNull();
    expect(hoods[2]?.cx).toBe(28_805_000);
    expect(stats.neighbourhoods).toBe(3);
    const tagged = all<{ hood_id: number }>(db, "SELECT hood_id FROM address WHERE number IN ('٣٤', '36')");
    expect(tagged).toEqual([{ hood_id: 3 }, { hood_id: 3 }]);
  });

  it('ignores admin rows that belong to another province', async () => {
    const { db, stats } = await build(baseRows());
    expect(stats.districts).toBe(2);
    expect(all(db, "SELECT id FROM neighbourhood WHERE name LIKE 'Baska%'")).toEqual([]);
  });

  it('writes polygons that decode and contain their own centre', async () => {
    const { db } = await build(baseRows());
    const moda = all<{ poly: Uint8Array; cx: number; cy: number }>(db, "SELECT poly, cx, cy FROM neighbourhood WHERE name = 'Moda'")[0] as { poly: Uint8Array; cx: number; cy: number };
    const rings = decodeRings(moda.poly);
    expect(pointInRings([moda.cx / 1e6, moda.cy / 1e6], rings)).toBe(true);
    expect(pointInRings([29.4, 40.6], rings)).toBe(false);
    const district = all<{ extra: string; name: string }>(db, 'SELECT name, extra FROM district ORDER BY id');
    expect(district.map((d) => d.name)).toEqual(['Kadıköy', 'Üsküdar']);
    expect(JSON.parse(district[0]?.extra as string)).toEqual({ names: { ru: 'Кадыкёй' }, alt: [] });
    expect(JSON.parse(district[1]?.extra as string).alt).toEqual(['Scutari']);
  });

  it('finds a street through the trigram index by its name, its Russian name and a misspelling', async () => {
    const { db } = await build(baseRows());
    const candidates = (typed: string): string[] => {
      const ids = new Set<number>();
      for (const code of trigramCodes(typed)) {
        const row = all<{ ids: Uint8Array }>(db, 'SELECT ids FROM tri WHERE code = ?', code)[0];
        if (row) for (const id of decodePostings(row.ids)) ids.add(id);
      }
      return all<{ id: number; kind: number; ref: number; lang: string; key: string }>(db, 'SELECT * FROM search_name').filter((s) => ids.has(s.id) && s.kind === 0).map((s) => `${s.lang}:${s.key}`).sort();
    };
    const russian = streetKey('улица Республики').key;
    expect(candidates('ataturk')).toEqual(expect.arrayContaining(['tr:ataturk']));
    expect(candidates('atatrk')).toEqual(expect.arrayContaining(['tr:ataturk']));
    expect(candidates('cumhuriyet')).toEqual(expect.arrayContaining(['tr:cumhuriyet']));
    expect(candidates(russian)).toEqual(expect.arrayContaining([`ru:${russian}`]));
    expect(all<{ key: string }>(db, "SELECT key FROM search_name WHERE kind = 0 AND lang = 'ru'")).toEqual([{ key: russian }]);
  });

  it('keeps every language name with its own text, also when its key equals the main key', async () => {
    const { db } = await build(baseRows());
    const rows = all<{ lang: string; key: string; name: string | null }>(db, "SELECT lang, key, name FROM search_name WHERE kind = 0 AND ref = 1 ORDER BY lang, key");
    expect(rows).toEqual([
      { lang: 'en', key: 'ataturk', name: 'Ataturk Street' },
      { lang: 'ru', key: streetKey('улица Республики').key, name: 'улица Республики' },
      { lang: 'tr', key: 'ataturk', name: null },
      { lang: 'tr', key: 'cumhuriyet', name: 'Cumhuriyet Cd' },
    ]);
  });

  it('keeps the other language text of a place', async () => {
    const { db } = await build(baseRows());
    expect(all(db, "SELECT lang, name FROM search_name WHERE kind = 1 AND lang = 'ru'")).toEqual([{ lang: 'ru', name: 'Государственная больница' }]);
  });

  it('builds the same pack when two tag spellings share one key, whatever the order', async () => {
    const make = (order: 'forward' | 'reverse') => {
      const rows = baseRows();
      rows.addresses = [
        address('n60', 'Gül Sokak', '1', 28.8, 41.2, where('r10', null, 'tag', 'Çarşı Mah.')),
        address('n61', 'Gül Sokak', '2', 28.81, 41.2, where('r10', null, 'tag', 'CARSI Mahallesi')),
        address('n62', 'Gül Sokak', '3', 28.82, 41.2, where('r10', null, 'tag', 'Çarşı')),
      ];
      if (order === 'reverse') rows.addresses.reverse();
      return rows;
    };
    const a = await build(make('forward'), 'a.sqlite');
    const b = await build(make('reverse'), 'b.sqlite');
    expect(sha(b.outFile)).toBe(sha(a.outFile));
    expect(all<{ name: string }>(a.db, "SELECT name FROM neighbourhood WHERE source = 1")).toEqual([{ name: 'Çarşı' }]);
  });

  it('breaks a tie between two spellings by the smaller text', async () => {
    const rows = baseRows();
    rows.addresses = [address('n60', 'Gül Sokak', '1', 28.8, 41.2, where('r10', null, 'tag', 'Çarşı')), address('n61', 'Gül Sokak', '2', 28.81, 41.2, where('r10', null, 'tag', 'CARSI'))];
    const { db } = await build(rows);
    expect(all(db, 'SELECT name FROM neighbourhood WHERE source = 1')).toEqual([{ name: 'CARSI' }]);
  });

  it('indexes places by name and other languages and keeps the kind dictionary', async () => {
    const { db, stats } = await build(baseRows());
    expect(stats.places).toBe(2);
    const kinds = all<{ id: number; name: string }>(db, 'SELECT * FROM poi_kind ORDER BY id');
    expect(kinds.map((k) => k.name)).toEqual([...kinds.map((k) => k.name)].sort());
    expect(kinds.map((k) => k.name)).toContain('hospital');
    const rows = all<{ name: string; kind: number; hood_id: number }>(db, 'SELECT name, kind, hood_id FROM poi ORDER BY id');
    expect(rows.map((r) => r.name).sort()).toEqual(['Devlet Hastanesi', 'Gül Eczanesi']);
    const keys = all<{ key: string }>(db, 'SELECT key FROM search_name WHERE kind = 1 ORDER BY key').map((r) => r.key);
    expect(keys).toContain(nameKey('Государственная больница'));
    expect(keys).toContain('devlet hastanesi');
  });

  it('keeps a detail row for each place that carries one, in the same order as the places', async () => {
    const rows = baseRows();
    rows.places = [
      { ...(rows.places[0] as object), info: { cat: 'hospital', brand: null, street: 'Bahariye Caddesi', number: '14', postcode: '34710', conf: 87 } },
      { ...(rows.places[1] as object), info: { cat: 'pharmacy', brand: 'Gül', street: null, number: null, postcode: null, conf: 40 } },
    ];
    const { db } = await build(rows);
    const details = all<{ name: string; cat: string; brand: string | null; street: string | null; number: string | null; postcode: number | null; conf: number }>(db, 'SELECT poi.name AS name, c.text AS cat, b.text AS brand, s.text AS street, i.number AS number, i.postcode AS postcode, i.conf AS conf FROM poi_info i JOIN poi ON poi.id = i.id LEFT JOIN info_text c ON c.id = i.cat LEFT JOIN info_text b ON b.id = i.brand LEFT JOIN info_text s ON s.id = i.street ORDER BY poi.id');
    expect(details).toEqual([
      { name: 'Devlet Hastanesi', cat: 'hospital', brand: null, street: 'Bahariye Caddesi', number: '14', postcode: 34710, conf: 87 },
      { name: 'Gül Eczanesi', cat: 'pharmacy', brand: 'Gül', street: null, number: null, postcode: null, conf: 40 },
    ]);
  });

  it('writes no detail table when no place has details', async () => {
    const { db } = await build(baseRows());
    expect(all(db, "SELECT name FROM sqlite_schema WHERE name = 'poi_info'")).toEqual([]);
  });

  it('writes the same bytes twice and when the input rows come in another order', async () => {
    const first = await build(baseRows(), 'a.sqlite');
    const second = await build(baseRows(), 'b.sqlite');
    const reversed = baseRows();
    reversed.addresses.reverse();
    reversed.streets.reverse();
    reversed.places.reverse();
    reversed.admin.reverse();
    const third = await build(reversed, 'c.sqlite');
    expect(sha(second.outFile)).toBe(sha(first.outFile));
    expect(sha(third.outFile)).toBe(sha(first.outFile));
  });

  it('writes a fixed page size, version and an intact file', async () => {
    const { db } = await build(baseRows());
    expect(all<{ page_size: number }>(db, 'PRAGMA page_size')[0]?.page_size).toBe(4096);
    expect(all<{ user_version: number }>(db, 'PRAGMA user_version')[0]?.user_version).toBe(FORMAT_VERSION);
    expect(all<{ application_id: number }>(db, 'PRAGMA application_id')[0]?.application_id).toBe(APPLICATION_ID);
    expect(all<{ integrity_check: string }>(db, 'PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(Object.fromEntries(all<{ k: string; v: string }>(db, 'SELECT k, v FROM meta').map((m) => [m.k, m.v]))).toEqual({ dropped_parts: '0', format: '2', osm_time: '2026-10-20T20:23:47Z', province: '34', scale: '1000000' });
  });

  it('counts the numbers it cannot read and the streets with no name left', async () => {
    const rows = baseRows();
    rows.addresses.push(address('n50', 'Gül Sokak', '1'.repeat(150), 28.6, 40.7), address('n51', '...', '5', 28.6, 40.7));
    const { stats } = await build(rows);
    expect(stats.skippedNumbers).toBe(1);
    expect(stats.emptyStreets).toBe(1);
    expect(stats.rows).toBe(9);
  });

  it('counts the street rows it could not name and writes the number into the pack', async () => {
    const rows = baseRows();
    rows.streets.push(part('სარფი', where('r10', 'r20'), [[[28.6, 40.9], [28.7, 40.9]]], ['w90']), part('+', where('r10', 'r20'), [[[28.6, 40.95], [28.7, 40.95]]], ['w91']));
    const { db, stats } = await build(rows);
    expect(stats.droppedParts).toBe(2);
    expect(all(db, "SELECT v FROM meta WHERE k = 'dropped_parts'")).toEqual([{ v: '2' }]);
    expect(all<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM street_part')[0]?.n).toBe(5);
  });

  it('stores the grid cell of every address and exactly the cells every street part passes through', async () => {
    const { db } = await build(baseRows());
    const addresses = all<{ cell: number; lon: number; lat: number }>(db, 'SELECT cell, lon, lat FROM address');
    expect(addresses.length).toBe(8);
    for (const a of addresses) expect(a.cell).toBe(cellOf(a.lon / 1e6, a.lat / 1e6));
    const parts = all<{ id: number; geom: Uint8Array }>(db, 'SELECT id, geom FROM street_part');
    const byCell = new Map(all<{ cell: number; parts: Uint8Array }>(db, 'SELECT cell, parts FROM street_cell').map((r) => [r.cell, decodePostings(r.parts)]));
    for (const part of parts) {
      const expected = [...new Set(decodeLines(part.geom).flatMap((line) => cellsOfLine(line)))].sort((a, b) => a - b);
      const stored = [...byCell].filter(([, ids]) => ids.includes(part.id)).map(([cell]) => cell).sort((a, b) => a - b);
      expect(stored).toEqual(expected);
    }
    for (const ids of byCell.values()) expect(ids.every((id) => parts.some((p) => p.id === id))).toBe(true);
  });

  it('indexes the cells so a cell lookup does not scan the table', async () => {
    const { db } = await build(baseRows());
    const plan = all<{ detail: string }>(db, 'EXPLAIN QUERY PLAN SELECT parts FROM street_cell WHERE cell = 1').map((r) => r.detail).join(' ');
    expect(plan).toMatch(/SEARCH|USING/);
    expect(plan).not.toMatch(/SCAN/);
    const planAddress = all<{ detail: string }>(db, 'EXPLAIN QUERY PLAN SELECT id FROM address WHERE cell = 1').map((r) => r.detail).join(' ');
    expect(planAddress).toMatch(/USING (COVERING )?INDEX/);
  });

  it('leaves no file behind when an input line is broken and replaces a stale temporary file', async () => {
    const dir = writeWork(baseRows());
    writeFileSync(join(dir, 'addresses', '34', 'addresses.jsonl'), '{"id":\n');
    const outFile = join(dir, 'broken.sqlite');
    await expect(buildAddressPack({ province: '34', workDir: dir, outFile, osmTimestamp: 't' })).rejects.toThrow(/addresses\.jsonl:1/);
    expect(existsSync(outFile)).toBe(false);
    expect(existsSync(`${outFile}.tmp`)).toBe(false);
    writeWork(baseRows(), dir);
    writeFileSync(`${outFile}.tmp`, 'half a file');
    await buildAddressPack({ province: '34', workDir: dir, outFile, osmTimestamp: 't' });
    expect(existsSync(`${outFile}.tmp`)).toBe(false);
    expect(open(outFile).prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('reports a missing input file by name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pack-'));
    await expect(buildAddressPack({ province: '34', workDir: dir, outFile: join(dir, 'x.sqlite'), osmTimestamp: 't' })).rejects.toThrow(/admin-pack.*dosya yok/);
  });

  it('builds a pack for a province with nothing in it', async () => {
    const { db, stats } = await build({ admin: baseAdmin().slice(0, 1), addresses: [], streets: [], places: [] });
    expect(stats).toMatchObject({ rows: 0, streets: 0, parts: 0, places: 0, searchNames: 0 });
    expect(all(db, 'SELECT * FROM address')).toEqual([]);
  });
});
