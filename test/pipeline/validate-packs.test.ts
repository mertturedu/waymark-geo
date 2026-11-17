import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAddressPack } from '../../pipeline/build/address-pack';
import { assemblePacks, ensureDevKey, signManifest } from '../../pipeline/build/manifest';
import { encodeBorders, createBorders } from '../../src/core/region/borders';
import { encodePostings } from '../../src/core/text/trigram';
import type { Runner } from '../../pipeline/build/tiles';
import { buildLearned } from '../../pipeline/build/learned';
import type { DeliveryRecord } from '../../pipeline/real/records';
import { validatePacks } from '../../pipeline/validate/validate-packs';
import { buildBuildingPack } from '../../pipeline/build/building-pack';
import { buildBuildingPack2 } from '../../pipeline/build/building-pack2';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import { rows as roadRows, way } from '../helpers/road-world';
import { buildingFile } from './helpers/building-fixture';
import { baseRows, writeWork } from './helpers/mini-work';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };
const bbox: [number, number, number, number] = [28.4, 40.4, 29.6, 41.6];
const BOUNDS = (west: number, south: number, east: number, north: number): string => `bounds: (long: ${west.toFixed(6)}, lat: ${south.toFixed(6)}) (long: ${east.toFixed(6)}, lat: ${north.toFixed(6)})\n`;

const runner = (options: { verifyCode?: number; bounds?: string } = {}): Runner => async (_cmd, args) =>
  args[0] === 'verify' ? { code: options.verifyCode ?? 0, out: 'bad tile' } : { code: 0, out: options.bounds ?? BOUNDS(28, 40, 30, 42) };

type Setup = { root: string; work: string; pack: string; tiles: string; key: string; stats: Awaited<ReturnType<typeof buildAddressPack>> };

async function setup(change?: (pack: string) => void, extra?: (work: string, pack: string) => Promise<string>, kind: 'buildings' | 'buildings2' | 'learned' = 'buildings'): Promise<Setup & { part: string | null }> {
  const work = writeWork(baseRows());
  const pack = join(work, 'pack.sqlite');
  const stats = await buildAddressPack({ province: '34', workDir: work, outFile: pack, osmTimestamp: sources.osmTimestamp });
  change?.(pack);
  const part = extra ? await extra(work, pack) : null;
  const tiles = join(work, 'tiles.pmtiles');
  writeFileSync(tiles, 'karo dosyası');
  const baseDir = join(work, 'base');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, 'overview.pmtiles'), 'genel harita');
  const root = join(mkdtempSync(join(tmpdir(), 'validate-')), 'packs');
  await assemblePacks({
    outDir: root,
    sources,
    regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox, stats: { addresses: stats.rows, streets: stats.streets, neighbourhoods: stats.neighbourhoods }, files: [{ kind: 'address', source: pack }, { kind: 'tiles', source: tiles }, ...(part ? [{ kind, source: part }] : [])] }],
    baseDir,
    keyDir: join(work, 'keys'),
    minSdk: '0.1.0',
  });
  return { root, work, pack, tiles, stats, part, key: ensureDevKey(join(work, 'keys')).publicKeyPem };
}

const errors = (findings: { level: string; message: string; where: string }[]): string[] => findings.filter((f) => f.level === 'error').map((f) => `${f.where}: ${f.message}`);
const manifestOf = (root: string) => JSON.parse(readFileSync(join(root, 'manifest-v1.json'), 'utf8')) as { regions: { files: { kind: string; path: string }[] }[]; base: { path: string }[] };
const fileOf = (root: string, kind: string): string => join(root, manifestOf(root).regions[0]?.files.find((f) => f.kind === kind)?.path as string);

describe('validatePacks', () => {
  it('finds nothing wrong with a sound set and sums it up', async () => {
    const s = await setup();
    const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({ regions: 1, files: 3, addressRows: 8, addressInHoodPolygon: 1 });
  });

  it('reports a file whose size changed', async () => {
    const s = await setup();
    appendFileSync(fileOf(s.root, 'tiles'), 'x');
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/tiles-.*boyut/);
  });

  it('reports a file with the same size but other bytes', async () => {
    const s = await setup();
    const path = fileOf(s.root, 'tiles');
    const bytes = readFileSync(path);
    bytes[0] = (bytes[0] as number) ^ 1;
    writeFileSync(path, bytes);
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/tiles-.*sha256/);
  });

  it('reports a file that is gone', async () => {
    const s = await setup();
    rmSync(join(s.root, manifestOf(s.root).base[0]?.path as string));
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/overview.*dosya yok/);
  });

  it('reports a manifest whose signature does not hold', async () => {
    const s = await setup();
    writeFileSync(join(s.root, 'manifest-v1.json'), readFileSync(join(s.root, 'manifest-v1.json'), 'utf8').replace('"minSdk": "0.1.0"', '"minSdk": "0.1.1"'));
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/imza/);
  });

  it('reports a cut off SQLite file even when its digest was written afterwards', async () => {
    const s = await setup((pack) => truncateSync(pack, 8192));
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/sqlite|SQLite/);
  });

  it('reports a pack with a missing table', async () => {
    const s = await setup((pack) => {
      const db = new DatabaseSync(pack);
      db.exec('DROP TABLE poi');
      db.close();
    });
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/poi/);
  });

  it('reports rows that point at something that is not there', async () => {
    const s = await setup((pack) => {
      const db = new DatabaseSync(pack);
      db.exec('UPDATE address SET street_id = 999 WHERE id = 1; UPDATE address SET hood_id = 888 WHERE id = 2');
      db.close();
    });
    const text = errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n');
    expect(text).toMatch(/street_id/);
    expect(text).toMatch(/hood_id/);
  });

  it('reports a street cell row that points at no street part and an address with the wrong cell', async () => {
    const s = await setup((pack) => {
      const db = new DatabaseSync(pack);
      db.prepare('INSERT INTO street_cell (cell, parts) VALUES (?, ?)').run(5, encodePostings([9999]));
      db.exec('UPDATE address SET cell = cell + 1 WHERE id = 1');
      db.close();
    });
    const text = errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n');
    expect(text).toMatch(/street_cell.*9999/);
    expect(text).toMatch(/address\.cell/);
  });

  it('reports a street part whose cells are missing', async () => {
    const s = await setup((pack) => {
      const db = new DatabaseSync(pack);
      db.exec('DELETE FROM street_cell');
      db.close();
    });
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/sokak parçası 1.*hücre/);
  });

  it('reports counts that disagree with the manifest', async () => {
    const s = await setup((pack) => {
      const db = new DatabaseSync(pack);
      db.exec('DELETE FROM address WHERE id = 3');
      db.close();
    });
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/adres.*8/);
  });

  it('reports a district whose centre is outside the province box', async () => {
    const s = await setup((pack) => {
      const db = new DatabaseSync(pack);
      db.exec('UPDATE district SET cx = 50000000 WHERE id = 1');
      db.close();
    });
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/ilçe.*merkez/);
  });

  it('reports a neighbourhood centre outside its own polygon as a warning', async () => {
    const s = await setup((pack) => {
      const db = new DatabaseSync(pack);
      db.exec('UPDATE neighbourhood SET cx = 29000000, cy = 40600000 WHERE id = 1');
      db.close();
    });
    const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
    expect(result.findings.filter((f) => f.level === 'warn').map((f) => f.message).join('\n')).toMatch(/mahalle.*merkez/);
  });

  it('warns when addresses fall outside their neighbourhood polygon too often', async () => {
    const s = await setup((pack) => {
      const db = new DatabaseSync(pack);
      db.exec('UPDATE address SET lon = 10000000, lat = 10000000 WHERE hood_id = 1');
      db.close();
    });
    const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
    expect(result.summary.addressInHoodPolygon).toBeLessThan(0.99);
    expect(result.findings.some((f) => f.level === 'warn' && /poligon/.test(f.message))).toBe(true);
  });

  it('reports tiles that do not pass pmtiles verify and a box that misses the province', async () => {
    const s = await setup();
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner({ verifyCode: 1 }) })).findings).join('\n')).toMatch(/verify/);
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner({ bounds: BOUNDS(28.5, 40.5, 29.5, 41.5) }) })).findings).join('\n')).toMatch(/sınır kutusu/);
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner({ bounds: 'nothing' }) })).findings).join('\n')).toMatch(/bounds/);
  });

  it('warns about a file the manifest does not list', async () => {
    const s = await setup();
    writeFileSync(join(s.root, '34', 'eski-dosya.sqlite'), 'artık');
    const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
    expect(result.findings.filter((f) => f.level === 'warn').map((f) => f.message).join('\n')).toMatch(/eski-dosya/);
    expect(errors(result.findings)).toEqual([]);
  });

  it('runs the independent Python check when the work folder is given', async () => {
    const s = await setup();
    const sound = await validatePacks(s.root, { publicKeyPem: s.key, run: runner(), work: s.work });
    expect(sound.findings).toEqual([]);
    expect(sound.summary.independentChecked).toBe(1);
    appendFileSync(join(s.work, 'addresses', '34', 'addresses.jsonl'), JSON.stringify({ id: 'n777', street: null, place: null, number: '77', postcode: null, lon: 28.6, lat: 40.7, tags: {}, district: 'r10', neighbourhood: 'r20', hoodName: null, hoodNames: null, hoodSource: 'polygon', slack: false }) + '\n');
    const broken = await validatePacks(s.root, { publicKeyPem: s.key, run: runner(), work: s.work });
    expect(errors(broken.findings).join('\n')).toMatch(/bağımsız denetim.*adres sayısı/);
  });

  it('does not trust a key that travels with the manifest when it was told which key to trust', async () => {
    const s = await setup();
    const trusted = ensureDevKey(join(s.work, 'keys')).publicKeyPem;
    const other = join(s.work, 'other-keys');
    const impostor = ensureDevKey(other);
    const text = readFileSync(join(s.root, 'manifest-v1.json'), 'utf8');
    writeFileSync(join(s.root, 'manifest-v1.json.sig'), signManifest(text, readFileSync(join(other, 'dev-signing.key'), 'utf8')));
    writeFileSync(join(s.root, 'dev-public-key.pem'), impostor.publicKeyPem);
    expect(errors((await validatePacks(s.root, { run: runner(), publicKeyPem: trusted })).findings).join('\n')).toMatch(/imza/);
    const untold = await validatePacks(s.root, { run: runner() });
    expect(errors(untold.findings)).toEqual([]);
    expect(untold.findings.some((f) => f.level === 'warn' && /güvenilir değil/.test(f.message))).toBe(true);
    const sound = await setup();
    const clean = await validatePacks(sound.root, { run: runner(), publicKeyPem: ensureDevKey(join(sound.work, 'keys')).publicKeyPem });
    expect(clean.findings).toEqual([]);
  });

  it('checks district centres against the real province outlines when given', async () => {
    const s = await setup();
    const square = (west: number, south: number, east: number, north: number) => [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]] as never;
    const fits = createBorders(encodeBorders([{ plate: '34', rings: square(28, 40, 30, 42) }]));
    expect((await validatePacks(s.root, { publicKeyPem: s.key, run: runner(), borders: fits })).findings).toEqual([]);
    const elsewhere = createBorders(encodeBorders([{ plate: '34', rings: square(28.5, 40.5, 28.9, 41.5) }]));
    const outside = await validatePacks(s.root, { publicKeyPem: s.key, run: runner(), borders: elsewhere });
    expect(errors(outside.findings)).toEqual([]);
    expect(outside.findings.filter((f) => f.level === 'warn').map((f) => f.message).join('\n')).toMatch(/ilçe 2 merkezi hiçbir il sınırının içinde değil/);
    const otherProvince = createBorders(encodeBorders([{ plate: '34', rings: square(28, 40, 28.6, 42) }, { plate: '41', rings: square(28.6, 40, 30, 42) }]));
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner(), borders: otherProvince })).findings).join('\n')).toMatch(/ilçe 1 merkezi il sınırının dışında, 41 ilinde/);
  });

  it('says clearly when there is no manifest', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'validate-'));
    const result = await validatePacks(empty, { run: runner() });
    expect(errors(result.findings).join('\n')).toMatch(/manifest-v1\.json/);
  });
});


describe('validatePacks building parts', () => {
  async function buildings(work: string, pack: string): Promise<string> {
    const addresses = baseRows().addresses as { lon: number; lat: number }[];
    buildingFile(work, '34', [...addresses.map((a, i) => ({ id: `w${i}`, lon: a.lon, lat: a.lat })), { id: 'w99', lon: 28.605, lat: 40.6001 }]);
    const out = join(work, 'buildings.sqlite');
    const result = await buildBuildingPack({ province: '34', workDir: work, addressFile: pack, outFile: out, osmTimestamp: sources.osmTimestamp });
    expect(result).toMatchObject({ written: true, buildings: 3 });
    return out;
  }

  it('finds nothing wrong with a sound building part', async () => {
    const s = await setup(undefined, buildings);
    const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({ files: 4, buildingCells: expect.any(Number) });
  });

  it('reports a building count that does not match the table', async () => {
    const s = await setup(undefined, async (work, pack) => {
      const out = await buildings(work, pack);
      const db = new DatabaseSync(out);
      db.exec("UPDATE meta SET v = '5' WHERE k = 'buildings'");
      db.close();
      return out;
    });
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/buildings-.*bina sayısı/);
  });

  it('reports a building that lies outside its cell or its region', async () => {
    const s = await setup(undefined, async (work, pack) => {
      const out = await buildings(work, pack);
      const db = new DatabaseSync(out);
      db.exec("UPDATE building_cell SET cell = cell + 3000");
      db.close();
      return out;
    });
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/buildings-.*(bölgenin dışında|hücre)/);
  });

  it('reports a part of another province or format', async () => {
    const s = await setup(undefined, async (work, pack) => {
      const out = await buildings(work, pack);
      const db = new DatabaseSync(out);
      db.exec("UPDATE meta SET v = '35' WHERE k = 'province'");
      db.close();
      return out;
    });
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/buildings-.*il/);
  });
  const broken = (sql: string) => async (work: string, pack: string) => {
    const out = await buildings(work, pack);
    const db = new DatabaseSync(out);
    db.exec(sql);
    db.close();
    return out;
  };

  it('reports a centre ratio that is not a number', async () => {
    const s = await setup(undefined, broken("UPDATE meta SET v = 'abc' WHERE k = 'ratio'"));
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/buildings-.*merkez oranı/);
  });

  it('reports a file that is not a building part by its application id', async () => {
    const s = await setup(undefined, broken('PRAGMA application_id = 1'));
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/buildings-.*application_id/);
  });

  it('reports a part without any building', async () => {
    const s = await setup(undefined, broken("DELETE FROM building_cell; UPDATE meta SET v = '0' WHERE k = 'buildings'"));
    expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/buildings-.*hiç bina/);
  });

  describe('route part', () => {
    const roads = (lon = 29): ReturnType<typeof roadRows> =>
      roadRows([
        way(1, [[1, lon, 41], [2, lon + 0.002, 41], [3, lon + 0.002, 41.002]]),
        way(2, [[3, lon + 0.002, 41.002], [4, lon, 41.002], [1, lon, 41]]),
      ]);
    const withRoute = async (make: () => Uint8Array) => {
      const s = await setup();
      const path = join(s.work, 'route.bin');
      writeFileSync(path, make());
      const root = join(mkdtempSync(join(tmpdir(), 'validate-')), 'packs');
      await assemblePacks({
        outDir: root,
        sources,
        regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox, stats: { addresses: s.stats.rows, streets: s.stats.streets, neighbourhoods: s.stats.neighbourhoods }, files: [{ kind: 'address', source: s.pack }, { kind: 'tiles', source: s.tiles }, { kind: 'route', source: path }] }],
        baseDir: join(s.work, 'base'),
        keyDir: join(s.work, 'keys'),
        minSdk: '0.3.0',
      });
      return { root, key: s.key };
    };

    it('accepts a sound route pack and counts its road pieces', async () => {
      const s = await withRoute(() => buildRoutePack(roads(), { ferries: false }).bytes);
      const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
      expect(result.findings).toEqual([]);
      expect(result.summary.routeEdges).toBeGreaterThan(0);
    });

    it('reports a file that is not a route pack', async () => {
      const s = await withRoute(() => buildRoutePack(roads(), { ferries: false }).bytes.slice(0, 100));
      expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/route-.*okunamadı/);
    });

    it('reports a pack whose roads lie outside the province', async () => {
      const s = await withRoute(() => buildRoutePack(roads(35), { ferries: false }).bytes);
      expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/route-.*kutusunda/);
    });
  });

  describe('directory part', () => {
    const listing = async (work: string): Promise<string> => {
      const out = join(work, 'directory.sqlite');
      const small = writeWork({ ...baseRows(), addresses: baseRows().addresses.slice(0, 2) });
      await buildAddressPack({ province: '34', workDir: small, outFile: out, osmTimestamp: sources.osmTimestamp, kinds: ['hospital', 'pharmacy'] });
      return out;
    };
    const withDirectory = async (change?: (path: string) => void) => {
      const s = await setup();
      const path = await listing(s.work);
      change?.(path);
      const root = join(mkdtempSync(join(tmpdir(), 'validate-')), 'packs');
      await assemblePacks({
        outDir: root,
        sources,
        regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox, stats: { addresses: s.stats.rows, streets: s.stats.streets, neighbourhoods: s.stats.neighbourhoods }, files: [{ kind: 'address', source: s.pack }, { kind: 'tiles', source: s.tiles }, { kind: 'directory', source: path }] }],
        baseDir: join(s.work, 'base'),
        keyDir: join(s.work, 'keys'),
        minSdk: '0.2.0',
      });
      return { root, key: s.key };
    };

    it('accepts a sound directory with other counts than the address pack', async () => {
      const s = await withDirectory();
      const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
      expect(result.findings).toEqual([]);
      expect(result.summary).toMatchObject({ addressRows: 8, directoryRows: 2 });
    });

    it('reports a directory that is not a pack of this province', async () => {
      const s = await withDirectory((path) => {
        const db = new DatabaseSync(path);
        db.exec("UPDATE meta SET v = '35' WHERE k = 'province'");
        db.close();
      });
      expect(errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n')).toMatch(/directory-.*province/);
    });
  });
});


describe('validatePacks buildings2 part and the two manifests', () => {
  async function buildings2(work: string, pack: string): Promise<string> {
    const addresses = baseRows().addresses as { lon: number; lat: number }[];
    const traces = [...addresses.slice(0, 3).map((a, i) => ({ id: `w${i}`, lon: a.lon, lat: a.lat, area: 120, ring: [[a.lon - 0.00004, a.lat - 0.00003], [a.lon + 0.00004, a.lat - 0.00003], [a.lon + 0.00004, a.lat + 0.00003], [a.lon - 0.00004, a.lat + 0.00003]], height: null, floors: i === 0 ? 5 : null, name: null, cls: null, src: null, rec: null }))];
    mkdirSync(join(work, 'building-traces'), { recursive: true });
    mkdirSync(join(work, 'building-tags'), { recursive: true });
    writeFileSync(join(work, 'building-traces', '34.jsonl'), traces.map((t) => JSON.stringify(t)).join('\n') + '\n');
    for (const name of ['osm-buildings.jsonl', 'entrances.jsonl', 'settlements.jsonl']) writeFileSync(join(work, 'building-tags', name), '');
    const out = join(work, 'buildings2.sqlite');
    expect(buildBuildingPack2({ province: '34', workDir: work, addressFile: pack, outFile: out, osmTimestamp: sources.osmTimestamp })).toMatchObject({ written: true, buildings: 3 });
    return out;
  }
  const manifestFile = (root: string, name: string) => JSON.parse(readFileSync(join(root, name), 'utf8')) as { format: number; minSdk: string; regions: { files: { kind: string; path: string; sha256: string }[] }[] };
  const messages = async (s: Setup): Promise<string> => errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n');
  const change = (path: string, sql: string): void => {
    const db = new DatabaseSync(path);
    db.exec(sql);
    db.close();
  };

  it('writes manifest-v1 without the new part and manifest-v2 with it, and finds nothing wrong', async () => {
    const s = await setup(undefined, buildings2, 'buildings2');
    expect(manifestFile(s.root, 'manifest-v1.json').regions[0]?.files.map((f) => f.kind)).toEqual(['address', 'tiles']);
    expect(manifestFile(s.root, 'manifest-v2.json').regions[0]?.files.map((f) => f.kind)).toEqual(['address', 'buildings2', 'tiles']);
    expect(manifestFile(s.root, 'manifest-v2.json')).toMatchObject({ format: 2, minSdk: '0.8.0' });
    const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({ files: 4, buildings2Cells: expect.any(Number) });
  });

  it('writes no manifest-v2 when there is nothing new in the release', async () => {
    const s = await setup();
    expect(existsSync(join(s.root, 'manifest-v2.json'))).toBe(false);
  });

  it('reports a part with the wrong format, count, region, levels or chain', async () => {
    const run = async (sql: string): Promise<string> => messages(await setup(undefined, async (work, pack) => { const out = await buildings2(work, pack); change(out, sql); return out; }, 'buildings2'));
    expect(await run("UPDATE meta SET v = '3' WHERE k = 'format'")).toMatch(/biçim sürümü beklenen değil/);
    expect(await run("UPDATE meta SET v = '9' WHERE k = 'buildings'")).toMatch(/bina sayısı uyuşmuyor/);
    expect(await run("UPDATE meta SET v = '06' WHERE k = 'province'")).toMatch(/il uyuşmuyor/);
    expect(await run('UPDATE building SET levels = 500')).toMatch(/kat sayısı/);
    expect(await run('UPDATE building SET lon = lon + 20000000')).toMatch(/bölgenin dışında/);
    expect(await run('UPDATE building SET chain = 999999')).toMatch(/sokak zinciri adres paketinde yok/);
    expect(await run('PRAGMA user_version = 7')).toMatch(/user_version/);
    expect(await run('PRAGMA application_id = 5')).toMatch(/application_id/);
    expect(await run('INSERT INTO entrance (id, building, lon, lat) VALUES (99, 12345, 1, 1)')).toMatch(/olmayan bir binaya bağlı/);
    expect(await run('DELETE FROM building_cell')).toMatch(/hücre dizini boş/);
    expect(await run('DELETE FROM building')).toMatch(/hiç bina yok/);
  });

  it('reports a manifest-v1 that carries a new kind, a v2 that disagrees with v1, and a wrong format or minSdk', async () => {
    const s = await setup(undefined, buildings2, 'buildings2');
    const v1 = manifestFile(s.root, 'manifest-v1.json');
    const v2 = manifestFile(s.root, 'manifest-v2.json');
    const signed = (name: string, value: unknown): void => {
      const text = `${JSON.stringify(value, null, 2)}\n`;
      writeFileSync(join(s.root, name), text);
      writeFileSync(join(s.root, `${name}.sig`), signManifest(text, readFileSync(join(s.work, 'keys', 'dev-signing.key'), 'utf8')));
    };
    signed('manifest-v2.json', { ...v2, minSdk: '0.7.0', regions: v2.regions.map((r) => ({ ...r, files: r.files.map((f) => (f.kind === 'address' ? { ...f, sha256: 'e'.repeat(64) } : f)) })) });
    const text = await messages(s);
    expect(text).toMatch(/minSdk 0\.8\.0 altında/);
    expect(text).toMatch(/v1 ile v2 arasında farklı/);
    signed('manifest-v1.json', { ...v1, regions: v2.regions });
    signed('manifest-v2.json', { ...v2, format: 1 });
    const second = await messages(s);
    expect(second).toMatch(/yalnız eski türleri içerebilir/);
    expect(second).toMatch(/manifest-v2\.json biçimi 2 olmalı/);
  });
});

describe('validatePacks learned part', () => {
  const centre = (): [number, number] => [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  async function learned(work: string): Promise<string> {
    const [lng, lat] = centre();
    const record = (src: string): DeliveryRecord => ({ v: 1, src, week: 2800, region: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '5', coordSource: 'gps', gps: { lng, lat, accuracyM: 8 } });
    const out = join(work, 'learned.sqlite');
    await buildLearned({ plate: '34', nowWeek: 2800, outFile: out, records: [record('a'), record('b')] });
    return out;
  }
  const change = (path: string, sql: string): void => {
    const db = new DatabaseSync(path);
    db.exec(sql);
    db.close();
  };
  const messages = async (s: Setup): Promise<string> => errors((await validatePacks(s.root, { publicKeyPem: s.key, run: runner() })).findings).join('\n');

  it('keeps the part out of manifest-v1, puts it in manifest-v2 and finds nothing wrong', async () => {
    const s = await setup(undefined, learned, 'learned');
    const files = (name: string) => (JSON.parse(readFileSync(join(s.root, name), 'utf8')) as { regions: { files: { kind: string }[] }[] }).regions[0]?.files.map((f) => f.kind);
    expect(files('manifest-v1.json')).toEqual(['address', 'tiles']);
    expect(files('manifest-v2.json')).toEqual(['address', 'learned', 'tiles']);
    const result = await validatePacks(s.root, { publicKeyPem: s.key, run: runner() });
    expect(result.findings).toEqual([]);
    expect(result.summary).toMatchObject({ learnedDoors: 1 });
  });

  it('reports a part with a person column, a wrong province or a point outside the region', async () => {
    const run = async (sql: string): Promise<string> => messages(await setup(undefined, async (work) => { const out = await learned(work); change(out, sql); return out; }, 'learned'));
    expect(await run('ALTER TABLE door ADD COLUMN courier TEXT')).toMatch(/kişi ya da zaman alanı/);
    expect(await run("UPDATE meta SET value = '06' WHERE key = 'region'")).toMatch(/il uyuşmuyor/);
    expect(await run('UPDATE door SET lng = lng + 20000000')).toMatch(/bölgenin dışında/);
    expect(await run('PRAGMA user_version = 4')).toMatch(/user_version/);
  });
});
