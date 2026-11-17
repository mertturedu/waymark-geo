import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { Decompress } from '../../src/core/packs/fzstd';
import { DatabaseSync } from 'node:sqlite';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRunner, parseBounds, pmtilesBin, type Runner } from '../build/tiles';
import { blocksOf } from '../build/blocks';
import { nameMatchesFormat } from '../build/tile-encode';
import type { Borders } from '../../src/core/region/borders';
import { cellOf, cellsOfLine } from '../../src/core/geo/cells';
import { decodePostings } from '../../src/core/text/trigram';
import { decodeLines, decodeRings, pointInRings } from '../../src/core/region/geom';
import { readPatchIndex } from '../../src/core/packs/patch';
import { parseManifest, type Box, type ManifestFile, type ManifestRegion } from '../../src/core/region/manifest';
import { APPLICATION_ID, FORMAT_VERSION } from '../build/address-pack';
import { APPLICATION_ID as BUILDING_APPLICATION_ID, BUILDING_FORMAT, CELL_E6 } from '../build/building-pack';
import { BUILDING2_APPLICATION_ID, namedBuildings } from '../build/building-pack-v2';
import { BUILDING_FORMAT_V2 } from '../../src/core/address/buildings2';
import { auditLearned } from './learned-audit';
import { MANIFEST_V1_KINDS, MANIFEST_V2_MIN_SDK } from '../build/manifest';
import { compareVersions } from '../../src/core/packs/verify';
import { CENTROID_MIN } from '../build/building-select';
import { createReader } from '../../src/core/region/geom';
import { createSearcher } from '../../src/core/route/ch-query';
import { readRoutePack } from '../../src/core/route/format';
import { plainGraph } from '../../src/core/route/oracle';
import { dijkstra } from '../../src/core/route/plain';

export type Finding = { level: 'error' | 'warn'; where: string; message: string };
export type ValidateOptions = { run?: Runner; work?: string; sampleRows?: number; publicKeyPem?: string; borders?: Borders };

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const TABLES = ['meta', 'district', 'neighbourhood', 'street_name', 'street_part', 'street_cell', 'address', 'poi_kind', 'poi', 'search_name', 'tri'];
const ORPHANS: [string, string, string, string][] = [
  ['address', 'street_id', 'street_name', 'id'],
  ['address', 'hood_id', 'neighbourhood', 'id'],
  ['address', 'district_id', 'district', 'id'],
  ['street_part', 'name_id', 'street_name', 'id'],
  ['street_part', 'hood_id', 'neighbourhood', 'id'],
  ['street_part', 'district_id', 'district', 'id'],
  ['poi', 'kind', 'poi_kind', 'id'],
  ['poi', 'hood_id', 'neighbourhood', 'id'],
  ['poi', 'district_id', 'district', 'id'],
  ['neighbourhood', 'district_id', 'district', 'id'],
];
const BOX_PAD = 0.05;
const POLYGON_SHARE = 0.99;

const hashFile = (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });

export function decodedSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = new Decompress((chunk) => void hash.update(chunk));
    let failed = false;
    createReadStream(path, { highWaterMark: 1 << 20 })
      .on('data', (chunk) => {
        if (failed) return;
        try {
          stream.push(chunk as Uint8Array, false);
        } catch (error) {
          failed = true;
          reject(error);
        }
      })
      .on('error', reject)
      .on('end', () => {
        if (failed) return;
        try {
          stream.push(new Uint8Array(0), true);
          resolve(hash.digest('hex'));
        } catch (error) {
          reject(error);
        }
      });
  });
}

function listFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listFiles(root, join(dir, entry.name)) : [relative(root, join(dir, entry.name)).split('\\').join('/')]));
}

type Rows = Record<string, unknown>[];

function checkPack(path: string, region: ManifestRegion, sampleRows: number, borders: Borders | undefined, add: (level: 'error' | 'warn', message: string) => void, counts = true): { rows: number; inside: number; checked: number } {
  const totals = { rows: 0, inside: 0, checked: 0 };
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    add('error', `SQLite açılamadı: ${String(error)}`);
    return totals;
  }
  try {
    const all = (sql: string): Rows => db.prepare(sql).all() as Rows;
    const one = (sql: string): number => Number(Object.values(all(sql)[0] ?? { n: 0 })[0]);
    const integrity = String((all('PRAGMA integrity_check')[0] as { integrity_check: string }).integrity_check);
    if (integrity !== 'ok') add('error', `SQLite bütünlük denetimi: ${integrity.slice(0, 200)}`);
    if (one('PRAGMA user_version') !== FORMAT_VERSION) add('error', 'user_version beklenen sürümde değil');
    if (one('PRAGMA application_id') !== APPLICATION_ID) add('error', 'application_id beklenen değerde değil');
    const present = new Set(all("SELECT name FROM sqlite_schema WHERE type = 'table'").map((r) => String(r.name)));
    const missing = TABLES.filter((t) => !present.has(t));
    for (const table of missing) add('error', `tablo yok: ${table}`);
    if (missing.length > 0) return totals;
    const province = all("SELECT v FROM meta WHERE k = 'province'")[0]?.v;
    if (province !== region.id) add('error', `meta province ${String(province)}, manifestte ${region.id}`);
    totals.rows = one('SELECT COUNT(*) FROM address');
    for (const [label, table, expected] of counts ? ([['adres', 'address', region.stats.addresses], ['sokak', 'street_name', region.stats.streets], ['mahalle', 'neighbourhood', region.stats.neighbourhoods]] as const) : []) {
      const actual = one(`SELECT COUNT(*) FROM ${table}`);
      if (actual !== expected) add('error', `${label} sayısı manifestte ${expected}, pakette ${actual}`);
    }
    for (const [table, column, target, key] of ORPHANS) {
      const n = one(`SELECT COUNT(*) FROM ${table} WHERE ${column} IS NOT NULL AND ${column} NOT IN (SELECT ${key} FROM ${target})`);
      if (n > 0) add('error', `${table}.${column}: ${n} satır olmayan kayda işaret ediyor`);
    }
    const wrongCells = all('SELECT lon, lat, cell FROM address').filter((a) => Number(a.cell) !== cellOf(Number(a.lon) / 1e6, Number(a.lat) / 1e6)).length;
    if (wrongCells > 0) add('error', `address.cell: ${wrongCells} satırda hücre numarası konumla uyuşmuyor`);
    const withCells = new Map<number, Set<number>>();
    const knownParts = new Set(all('SELECT id FROM street_part').map((p) => Number(p.id)));
    for (const c of all('SELECT cell, parts FROM street_cell')) {
      for (const id of decodePostings(c.parts as Uint8Array)) {
        if (!knownParts.has(id)) add('error', `street_cell.parts: hücre ${String(c.cell)} olmayan sokak parçası ${id} diyor`);
        const set = withCells.get(id) ?? new Set<number>();
        set.add(Number(c.cell));
        withCells.set(id, set);
      }
    }
    for (const part of all('SELECT id, geom FROM street_part')) {
      const expected = new Set(decodeLines(part.geom as Uint8Array).flatMap((line) => cellsOfLine(line)));
      const stored = withCells.get(Number(part.id)) ?? new Set<number>();
      if (expected.size !== stored.size || [...expected].some((cell) => !stored.has(cell))) add('error', `sokak parçası ${String(part.id)}: hücre kaydı sokak çizgisiyle uyuşmuyor`);
    }
    const [west, south, east, north] = region.bbox;
    const districts = new Map<number, ReturnType<typeof decodeRings>>();
    for (const d of all('SELECT id, cx, cy, poly FROM district ORDER BY id')) {
      const lon = Number(d.cx) / 1e6;
      const lat = Number(d.cy) / 1e6;
      if (lon < west - BOX_PAD || lon > east + BOX_PAD || lat < south - BOX_PAD || lat > north + BOX_PAD) add('error', `ilçe ${String(d.id)} merkezi il kutusunun dışında`);
      const inside = borders?.provinceAt(lon, lat);
      if (borders && inside === null) add('warn', `ilçe ${String(d.id)} merkezi hiçbir il sınırının içinde değil`);
      else if (borders && inside !== region.id) add('error', `ilçe ${String(d.id)} merkezi il sınırının dışında, ${String(inside)} ilinde`);
      try {
        const rings = decodeRings(d.poly as Uint8Array);
        districts.set(Number(d.id), rings);
        if (!pointInRings([lon, lat], rings)) add('warn', `ilçe ${String(d.id)} merkezi kendi poligonunun dışında`);
      } catch (error) {
        add('error', `ilçe ${String(d.id)} poligonu okunamadı: ${String(error)}`);
      }
    }
    const hoods = new Map<number, ReturnType<typeof decodeRings>>();
    for (const h of all('SELECT id, district_id, cx, cy, poly FROM neighbourhood WHERE poly IS NOT NULL ORDER BY id')) {
      try {
        const rings = decodeRings(h.poly as Uint8Array);
        hoods.set(Number(h.id), rings);
        const center: [number, number] = [Number(h.cx) / 1e6, Number(h.cy) / 1e6];
        if (!pointInRings(center, rings)) add('warn', `mahalle ${String(h.id)} merkezi kendi poligonunun dışında`);
        const parent = districts.get(Number(h.district_id));
        if (parent && !pointInRings(center, parent)) add('warn', `mahalle ${String(h.id)} merkezi ilçe poligonunun dışında`);
      } catch (error) {
        add('error', `mahalle ${String(h.id)} poligonu okunamadı: ${String(error)}`);
      }
    }
    const step = Math.max(1, Math.floor(totals.rows / sampleRows));
    for (const a of all('SELECT id, hood_id, lon, lat FROM address WHERE hood_id IS NOT NULL ORDER BY id')) {
      if (Number(a.id) % step !== 0 && step > 1) continue;
      const rings = hoods.get(Number(a.hood_id));
      if (!rings) continue;
      totals.checked += 1;
      if (pointInRings([Number(a.lon) / 1e6, Number(a.lat) / 1e6], rings)) totals.inside += 1;
    }
    if (totals.checked > 0 && totals.inside / totals.checked < POLYGON_SHARE) add('warn', `adreslerin yalnızca ${totals.inside}/${totals.checked} kadarı mahalle poligonunun içinde`);
  } catch (error) {
    add('error', `SQLite okunamadı: ${String(error)}`);
  } finally {
    db.close();
  }
  return totals;
}

async function checkTiles(path: string, bbox: Box | null, run: Runner, add: (level: 'error' | 'warn', message: string) => void): Promise<void> {
  const verified = await run(pmtilesBin, ['verify', path]);
  if (verified.code !== 0) add('error', `pmtiles verify başarısız: ${verified.out.slice(-200)}`);
  if (!bbox) return;
  const shown = await run(pmtilesBin, ['show', path]);
  const bounds = parseBounds(shown.out);
  if (!bounds) {
    add('error', 'başlıktaki bounds okunamadı');
    return;
  }
  const eps = 1e-6;
  if (bounds[0] > bbox[0] + eps || bounds[1] > bbox[1] + eps || bounds[2] < bbox[2] - eps || bounds[3] < bbox[3] - eps) add('error', 'sınır kutusu il kutusunu kapsamıyor');
}

async function independent(pack: string, work: string, plate: string, sample: number, add: (level: 'error' | 'warn', message: string) => void): Promise<void> {
  const { spawnSync } = await import('node:child_process');
  const run = spawnSync(join(repoRoot, 'pipeline', '.venv', 'bin', 'python'), [join(repoRoot, 'pipeline', 'validate', 'check_pack.py'), pack, work, plate, '--sample', String(sample)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try {
    const result = JSON.parse(run.stdout.trim().split('\n').pop() as string) as { ok: boolean; problems: string[] };
    for (const problem of result.problems) add('error', `bağımsız denetim: ${problem}`);
  } catch {
    add('error', `bağımsız denetim çalışmadı: ${(run.stderr || run.stdout).slice(-200)}`);
  }
}

function checkBuildings(path: string, region: ManifestRegion, add: (level: 'error' | 'warn', message: string) => void): number {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    add('error', `SQLite açılamadı: ${String(error)}`);
    return 0;
  }
  try {
    const all = (sql: string): Rows => db.prepare(sql).all() as Rows;
    const integrity = String((all('PRAGMA integrity_check')[0] as { integrity_check: string }).integrity_check);
    if (integrity !== 'ok') add('error', `SQLite bütünlük denetimi: ${integrity.slice(0, 200)}`);
    if (Number((all('PRAGMA user_version')[0] as { user_version: number }).user_version) !== BUILDING_FORMAT) add('error', 'user_version beklenen sürümde değil');
    const meta = new Map(all('SELECT k, v FROM meta').map((r) => [String(r.k), String(r.v)]));
    if (meta.get('format') !== String(BUILDING_FORMAT)) add('error', `biçim sürümü beklenen değil: ${String(meta.get('format'))}`);
    if (meta.get('province') !== region.id) add('error', `il uyuşmuyor (dosya ${String(meta.get('province'))}, bölge ${region.id})`);
    const ratio = Number(meta.get('ratio'));
    if (!(ratio >= CENTROID_MIN)) add('error', `merkez oranı eşiğin altında ya da sayı değil: ${String(meta.get('ratio'))}`);
    if (Number((all('PRAGMA application_id')[0] as { application_id: number }).application_id) !== BUILDING_APPLICATION_ID) add('error', 'application_id beklenen değerde değil');
    const box = region.bbox;
    let total = 0;
    let outside = 0;
    let badCell = 0;
    const cells = all('SELECT cell, pts FROM building_cell ORDER BY cell');
    for (const row of cells) {
      const cell = Number(row.cell);
      const cy = Math.floor(cell / 65536);
      const cx = cell - cy * 65536;
      try {
        const reader = createReader(row.pts as Uint8Array);
        const count = reader.varint();
        for (let i = 0; i < count; i++) {
          const x = reader.varint();
          const y = reader.varint();
          if (x >= CELL_E6 || y >= CELL_E6) badCell += 1;
          const lng = (cx * CELL_E6 + x) / 1e6;
          const lat = (cy * CELL_E6 + y) / 1e6;
          if (lng < box[0] - BOX_PAD || lng > box[2] + BOX_PAD || lat < box[1] - BOX_PAD || lat > box[3] + BOX_PAD) outside += 1;
        }
        reader.done();
        total += count;
      } catch {
        add('error', `hücre ${cell} okunamadı`);
      }
    }
    if (total === 0) add('error', 'parçada hiç bina yok');
    if (Number(meta.get('buildings')) !== total) add('error', `bina sayısı uyuşmuyor (meta ${String(meta.get('buildings'))}, tablo ${total})`);
    if (badCell > 0) add('error', `${badCell} bina kendi hücresinin dışında (hücre ofseti)`);
    if (outside > 0) add('error', `${outside} bina bölgenin dışında`);
    return cells.length;
  } finally {
    db.close();
  }
}

const BUILDING2_MIN_LEVELS = 1;
const BUILDING2_MAX_LEVELS = 200;
const CHAIN_MISSING_SHARE = 0.001;

function checkBuildings2(path: string, region: ManifestRegion, addressPath: string | null, add: (level: 'error' | 'warn', message: string) => void): number {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (error) {
    add('error', `SQLite açılamadı: ${String(error)}`);
    return 0;
  }
  try {
    const all = (sql: string): Rows => db.prepare(sql).all() as Rows;
    const one = (sql: string): Record<string, unknown> => (all(sql)[0] ?? {}) as Record<string, unknown>;
    const integrity = String((one('PRAGMA integrity_check') as { integrity_check: string }).integrity_check);
    if (integrity !== 'ok') add('error', `SQLite bütünlük denetimi: ${integrity.slice(0, 200)}`);
    if (Number(one('PRAGMA user_version').user_version) !== Number(BUILDING_FORMAT_V2)) add('error', 'user_version beklenen sürümde değil');
    if (Number(one('PRAGMA application_id').application_id) !== BUILDING2_APPLICATION_ID) add('error', 'application_id beklenen değerde değil');
    const meta = new Map(all('SELECT k, v FROM meta').map((r) => [String(r.k), String(r.v)]));
    if (meta.get('format') !== BUILDING_FORMAT_V2) add('error', `biçim sürümü beklenen değil: ${String(meta.get('format'))}`);
    if (meta.get('province') !== region.id) add('error', `il uyuşmuyor (dosya ${String(meta.get('province'))}, bölge ${region.id})`);
    const total = Number(one('SELECT COUNT(*) AS n FROM building').n);
    if (total === 0) add('error', 'parçada hiç bina yok');
    if (Number(meta.get('buildings')) !== total) add('error', `bina sayısı uyuşmuyor (meta ${String(meta.get('buildings'))}, tablo ${total})`);
    const box = region.bbox;
    const outside = Number(one(`SELECT COUNT(*) AS n FROM building WHERE lon < ${Math.round((box[0] - BOX_PAD) * 1e6)} OR lon > ${Math.round((box[2] + BOX_PAD) * 1e6)} OR lat < ${Math.round((box[1] - BOX_PAD) * 1e6)} OR lat > ${Math.round((box[3] + BOX_PAD) * 1e6)}`).n);
    if (outside > 0) add('error', `${outside} bina bölgenin dışında`);
    const badLevels = Number(one(`SELECT COUNT(*) AS n FROM building WHERE levels < ${BUILDING2_MIN_LEVELS} OR levels > ${BUILDING2_MAX_LEVELS} OR lsrc NOT BETWEEN 1 AND 4 OR area <= 0 OR length(ring) = 0`).n);
    if (badLevels > 0) add('error', `${badLevels} binada kat sayısı, kaynak, alan ya da çizgi geçersiz`);
    const orphans = Number(one('SELECT COUNT(*) AS n FROM entrance WHERE building NOT IN (SELECT id FROM building)').n);
    if (orphans > 0) add('error', `${orphans} giriş olmayan bir binaya bağlı`);
    if (all("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'building_name'").length > 0) {
      const expected = namedBuildings(all('SELECT name FROM building WHERE name IS NOT NULL ORDER BY id').map((r) => ({ trace: { name: String(r.name) } }))).length;
      const written = Number(one('SELECT COUNT(*) AS n FROM building_name').n);
      const stray = Number(one('SELECT COUNT(*) AS n FROM building_name WHERE id NOT IN (SELECT id FROM building)').n);
      if (stray > 0) add('error', `${stray} bina adı olmayan bir binaya bağlı`);
      if (written > expected) add('error', `bina adı tablosu beklenenden büyük (${written} > ${expected})`);
    }
    const cellless = Number(one('SELECT COUNT(*) AS n FROM building_cell').n);
    if (cellless === 0) add('error', 'hücre dizini boş');
    if (addressPath !== null && existsSync(addressPath)) {
      const chains = all('SELECT DISTINCT chain FROM building WHERE chain IS NOT NULL').map((r) => Number(r.chain));
      const address = new DatabaseSync(addressPath, { readOnly: true });
      try {
        const known = new Set((address.prepare('SELECT id FROM street_name').all() as { id: number }[]).map((r) => r.id));
        const missing = chains.filter((id) => !known.has(id)).length;
        if (chains.length > 0 && missing / chains.length > CHAIN_MISSING_SHARE) add('error', `${missing} / ${chains.length} sokak zinciri adres paketinde yok (paketler aynı adres paketinden kurulmamış)`);
      } finally {
        address.close();
      }
    }
    return cellless;
  } finally {
    db.close();
  }
}

const ROUTE_PAIRS = 12;

function checkRoute(path: string, region: ManifestRegion, add: (level: 'error' | 'warn', message: string) => void): number {
  let pack;
  try {
    pack = readRoutePack(readFileSync(path));
  } catch (error) {
    add('error', `rota paketi okunamadı: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
  const [west, south, east, north] = region.bbox;
  let within = 0;
  for (let i = 0; i < pack.base.count; i++) {
    const lon = (pack.base.lon[i] as number) / 1e6;
    const lat = (pack.base.lat[i] as number) / 1e6;
    if (lon >= west && lon <= east && lat >= south && lat <= north) within++;
  }
  if (within === 0) add('error', `rota paketinin yolları ${region.id} ilinin kutusunda değil`);
  const h = pack.hierarchy;
  if (h.n > 0) {
    const graph = plainGraph(h);
    const searcher = createSearcher(h);
    let seed = 20261027;
    const next = (): number => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % h.n;
    for (let k = 0; k < ROUTE_PAIRS; k++) {
      const from = next();
      const to = next();
      const expected = (dijkstra(graph, [{ node: from, dist: 0 }])[to] as number) ?? Infinity;
      const got = searcher.path([{ node: from, w: 0, len: 0 }], [{ node: to, w: 0, len: 0 }]);
      if ((got?.weight ?? Infinity) !== expected) {
        add('error', `rota paketi kendi yollarıyla uyuşmuyor (${from} → ${to}: ${got?.weight ?? 'yok'}, olması gereken ${expected})`);
        break;
      }
    }
  }
  return pack.edges.count;
}

export async function validatePacks(root: string, options: ValidateOptions = {}): Promise<{ findings: Finding[]; summary: Record<string, number> }> {
  const run = options.run ?? defaultRunner;
  const findings: Finding[] = [];
  const summary: Record<string, number> = { regions: 0, files: 0, bytes: 0, addressRows: 0, addressInHoodPolygon: 1, independentChecked: 0 };
  const report = (where: string) => (level: 'error' | 'warn', message: string): void => void findings.push({ level, where, message });
  const v1Path = join(root, 'manifest-v1.json');
  const v2Path = join(root, 'manifest-v2.json');
  if (!existsSync(v1Path)) {
    report('manifest-v1.json')('error', 'manifest-v1.json yok');
    return { findings, summary };
  }
  const readManifest = (name: string, path: string) => {
    const text = readFileSync(path, 'utf8');
    let parsed;
    try {
      parsed = parseManifest(text);
    } catch (error) {
      report(name)('error', String(error));
      return null;
    }
    if (options.publicKeyPem === undefined) report(name)('warn', 'açık anahtar paketin yanından okundu, güvenilir değil');
    try {
      const key = options.publicKeyPem ?? readFileSync(join(root, 'dev-public-key.pem'), 'utf8');
      const signature = Buffer.from(readFileSync(`${path}.sig`, 'utf8').trim(), 'base64');
      if (!verify(null, Buffer.from(text), createPublicKey(key), signature)) report(name)('error', 'imza geçersiz');
    } catch {
      report(name)('error', 'imza okunamadı ya da açık anahtar yok');
    }
    return parsed;
  };
  const first = readManifest('manifest-v1.json', v1Path);
  if (!first) return { findings, summary };
  const second = existsSync(v2Path) ? readManifest('manifest-v2.json', v2Path) : null;
  if (first.format !== 1) report('manifest-v1.json')('error', 'manifest-v1.json biçimi 1 olmalı');
  if (first.regions.some((r) => r.files.some((f) => !MANIFEST_V1_KINDS.includes(f.kind)))) report('manifest-v1.json')('error', 'manifest-v1.json yalnız eski türleri içerebilir (eski SDK yeni türde kırılıyordu)');
  if (second) {
    if (second.format !== 2) report('manifest-v2.json')('error', 'manifest-v2.json biçimi 2 olmalı');
    if (compareVersions(second.minSdk, MANIFEST_V2_MIN_SDK) < 0) report('manifest-v2.json')('error', `minSdk ${MANIFEST_V2_MIN_SDK} altında`);
    const fingerprints = new Map(second.regions.flatMap((r) => r.files.map((f) => [`${r.id}/${f.kind}`, `${f.path}:${f.sha256}`] as const)));
    for (const r of first.regions) for (const f of r.files) if (fingerprints.get(`${r.id}/${f.kind}`) !== `${f.path}:${f.sha256}`) report('manifest-v2.json')('error', `${r.id} ${f.kind} dosyası v1 ile v2 arasında farklı ya da v2'de yok`);
    if (JSON.stringify(first.base) !== JSON.stringify(second.base)) report('manifest-v2.json')('error', 'taban dosyaları v1 ile v2 arasında farklı');
  }
  const manifest = second ?? first;

  const listed = new Set<string>();
  const sound = new Set<string>();
  const entries: { file: ManifestFile; region: ManifestRegion | null }[] = [...manifest.base.map((file) => ({ file, region: null })), ...manifest.regions.flatMap((region) => region.files.map((file) => ({ file, region })))];
  for (const { file } of entries) {
    listed.add(file.path);
    summary.files = (summary.files ?? 0) + 1;
    summary.bytes = (summary.bytes ?? 0) + file.size;
    const add = report(file.path);
    const full = join(root, file.path);
    if (!existsSync(full)) {
      add('error', 'dosya yok');
    } else if (statSync(full).size !== file.size) {
      add('error', `boyut uyuşmuyor (manifest ${file.size}, dosya ${statSync(full).size})`);
    } else if ((await hashFile(full)) !== file.sha256) {
      add('error', 'sha256 uyuşmuyor');
    } else {
      sound.add(file.path);
    }
    for (const patch of file.patches ?? []) {
      listed.add(patch.path);
      summary.patchFiles = (summary.patchFiles ?? 0) + 1;
      summary.patchBytes = (summary.patchBytes ?? 0) + patch.size;
      const addPatch = report(patch.path);
      const patchFull = join(root, patch.path);
      if (!existsSync(patchFull)) addPatch('error', 'yama dosyası yok');
      else if (statSync(patchFull).size !== patch.size) addPatch('error', `yama boyutu uyuşmuyor (manifest ${patch.size}, dosya ${statSync(patchFull).size})`);
      else if ((await hashFile(patchFull)) !== patch.sha256) addPatch('error', 'yama sha256 uyuşmuyor');
      else if (JSON.stringify(blocksOf(patchFull)) !== JSON.stringify(patch.blocks)) addPatch('error', 'yama blok özetleri uyuşmuyor ya da eksik');
      else {
        const index = readPatchIndex(new Uint8Array(readFileSync(patchFull)));
        if (index === null) addPatch('error', 'yama başlığı ya da dilim dizini geçersiz');
        else if (index.newSize !== file.size) addPatch('error', `yama yeni dosya boyunu ${index.newSize} sanıyor, manifestte ${file.size}`);
      }
      if (patch.size >= (file.encoded?.size ?? file.size)) addPatch('warn', 'yama tam indirmeden küçük değil');
    }
    if (file.encoded) {
      listed.add(file.encoded.path);
      summary.encodedFiles = (summary.encodedFiles ?? 0) + 1;
      summary.encodedBytes = (summary.encodedBytes ?? 0) + file.encoded.size;
      const addEncoded = report(file.encoded.path);
      const encodedFull = join(root, file.encoded.path);
      if (!existsSync(encodedFull)) addEncoded('error', 'sıkıştırılmış dosya yok');
      else if (statSync(encodedFull).size !== file.encoded.size) addEncoded('error', `sıkıştırılmış boyut uyuşmuyor (manifest ${file.encoded.size}, dosya ${statSync(encodedFull).size})`);
      else if ((await hashFile(encodedFull)) !== file.encoded.sha256) addEncoded('error', 'sıkıştırılmış sha256 uyuşmuyor');
      else if ((await decodedSha256(encodedFull).catch(() => '')) !== file.sha256) addEncoded('error', 'zstd açılınca asıl dosyanın sha256 değeri çıkmıyor');
      if (file.encoded.size >= file.size) addEncoded('warn', 'sıkıştırılmış dosya asıl dosyadan küçük değil');
    }
  }
  for (const path of listFiles(root)) if (!listed.has(path) && !['manifest-v1.json', 'manifest-v1.json.sig', 'manifest-v2.json', 'manifest-v2.json.sig', 'dev-public-key.pem'].includes(path)) report(path)('warn', `manifestte olmayan dosya: ${path}`);

  summary.regions = manifest.regions.length;
  let checked = 0;
  let inside = 0;
  for (const { file, region } of entries) {
    if (!sound.has(file.path)) continue;
    const full = join(root, file.path);
    const add = report(file.path);
    if (file.path.endsWith('.pmtiles') && !nameMatchesFormat(file.path, full)) add('error', 'dosya adı karo biçimiyle uyuşmuyor (.mlt.pmtiles yalnızca MLT içindir)');
    if (file.kind === 'address' && region) {
      const totals = checkPack(full, region, options.sampleRows ?? 50_000, options.borders, add);
      summary.addressRows = (summary.addressRows ?? 0) + totals.rows;
      checked += totals.checked;
      inside += totals.inside;
      if (options.work) {
        summary.independentChecked = (summary.independentChecked ?? 0) + 1;
        await independent(full, options.work, region.id, 2000, add);
      }
    } else if (file.kind === 'directory' && region) {
      const totals = checkPack(full, region, options.sampleRows ?? 50_000, options.borders, add, false);
      summary.directoryRows = (summary.directoryRows ?? 0) + totals.rows;
    } else if (file.kind === 'route' && region) {
      summary.routeEdges = (summary.routeEdges ?? 0) + checkRoute(full, region, add);
    } else if (file.kind === 'buildings' && region) {
      summary.buildingCells = (summary.buildingCells ?? 0) + checkBuildings(full, region, add);
    } else if (file.kind === 'buildings2' && region) {
      const addressFile = region.files.find((f) => f.kind === 'address');
      summary.buildings2Cells = (summary.buildings2Cells ?? 0) + checkBuildings2(full, region, addressFile ? join(root, addressFile.path) : null, add);
    } else if (file.kind === 'learned' && region) {
      const audit = auditLearned(full, region.id, region.bbox);
      for (const message of audit.errors) add('error', message);
      summary.learnedDoors = (summary.learnedDoors ?? 0) + audit.counts.doors;
    } else if (file.kind === 'tiles' && region) {
      await checkTiles(full, region.bbox, run, add);
    } else if (file.path.endsWith('.pmtiles')) {
      await checkTiles(full, null, run, add);
    }
  }
  if (checked > 0) summary.addressInHoodPolygon = inside / checked;
  return { findings, summary };
}
