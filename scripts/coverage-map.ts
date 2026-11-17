import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRegion } from '../src/core/address/pack';
import { lineLengthM } from '../src/core/geo/distance';
import { decodeLines, pointInRings, type Polygon } from '../src/core/region/geom';
import { openSqlite } from '../src/node/sqlite';
import type { LngLat } from '../src/core/geo/cells';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const WORK = join(repoRoot, 'dist', 'work', '261028');
export const OUT = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'kapsama');
export const WEAK = { minBuildings: 50, maxScore: 25 };
const GRID = 0.01;

export type HoodRow = {
  plate: string; district: string; hood: string; hoodId: number;
  streets: number; streetKm: number; doors: number; buildings: number; linked: number; levelsKnown: number; entrances: number; pois: number; unnamedRoads: number;
  doorsPerBuilding: number; linkedShare: number; score: number; weak: string[]; level: string;
};

export function scoreOf(row: Pick<HoodRow, 'buildings' | 'doors' | 'linked' | 'streetKm'>): number {
  if (row.buildings === 0) return row.doors > 0 ? 50 : 0;
  const doors = Math.min(1, row.doors / row.buildings / 0.3);
  const linked = row.linked / row.buildings;
  const streets = Math.min(1, row.streetKm / row.buildings / 0.02);
  return Math.round(100 * (0.5 * doors + 0.3 * linked + 0.2 * streets));
}

export function levelOf(row: Pick<HoodRow, 'buildings' | 'score'>): string {
  if (row.buildings < WEAK.minBuildings) return 'az bina';
  return row.score >= 60 ? 'iyi' : row.score >= 40 ? 'orta' : row.score > WEAK.maxScore ? 'zayıf' : 'çok zayıf';
}

export function weakOf(row: Pick<HoodRow, 'buildings' | 'doors' | 'linked' | 'streets' | 'score' | 'unnamedRoads'>): string[] {
  if (row.buildings < WEAK.minBuildings) return [];
  const out: string[] = [];
  if (row.doors / row.buildings < 0.05) out.push('kapı yok denecek kadar az');
  if (row.linked / row.buildings < 0.6) out.push('binaların çoğu sokağa bağlı değil');
  if (row.streets === 0) out.push('adlı sokak yok');
  if (row.unnamedRoads > 20 && row.unnamedRoads > row.streets) out.push('adsız yol adlı sokaktan çok');
  return row.score <= WEAK.maxScore || out.length >= 2 ? out : [];
}

type Index = { locate(lon: number, lat: number): number | null };

function hoodIndex(polys: Map<number, Polygon[]>): Index {
  const cells = new Map<string, number[]>();
  const boxes = new Map<number, [number, number, number, number]>();
  for (const [id, polygons] of polys) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const polygon of polygons) for (const ring of polygon) for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    if (w > e) continue;
    boxes.set(id, [w, s, e, n]);
    for (let cx = Math.floor(w / GRID); cx <= Math.floor(e / GRID); cx++) for (let cy = Math.floor(s / GRID); cy <= Math.floor(n / GRID); cy++) {
      const key = `${cx}:${cy}`;
      (cells.get(key) ?? cells.set(key, []).get(key) as number[]).push(id);
    }
  }
  return {
    locate(lon, lat) {
      for (const id of cells.get(`${Math.floor(lon / GRID)}:${Math.floor(lat / GRID)}`) ?? []) {
        const box = boxes.get(id) as [number, number, number, number];
        if (lon < box[0] || lon > box[2] || lat < box[1] || lat > box[3]) continue;
        if (pointInRings([lon, lat], polys.get(id) as Polygon[])) return id;
      }
      return null;
    },
  };
}

export async function coverageOf(plate: string): Promise<HoodRow[] | null> {
  const dir = join(WORK, 'packs', plate);
  if (!existsSync(join(dir, 'address.sqlite'))) return null;
  const address = openSqlite(join(dir, 'address.sqlite'));
  const buildings = existsSync(join(dir, 'buildings2.sqlite')) ? openSqlite(join(dir, 'buildings2.sqlite')) : null;
  const directory = existsSync(join(dir, 'directory.sqlite')) ? openSqlite(join(dir, 'directory.sqlite')) : null;
  try {
    const region = await openRegion(address);
    const polys = new Map<number, Polygon[]>();
    for (const d of region.districts) for (const [id, p] of await region.hoodPolygons(d.id)) polys.set(id, p);
    const index = hoodIndex(polys);
    const rows = new Map<number, HoodRow>(region.hoods.map((h) => [h.id, { plate, district: region.districts.find((d) => d.id === h.districtId)?.name ?? '', hood: h.name, hoodId: h.id, streets: 0, streetKm: 0, doors: 0, buildings: 0, linked: 0, levelsKnown: 0, entrances: 0, pois: 0, unnamedRoads: 0, doorsPerBuilding: 0, linkedShare: 0, score: 0, weak: [], level: '' }]));
    const streetSets = new Map<number, Set<number>>();
    for (const part of await address.all<{ name_id: number; hood_id: number | null; geom: Uint8Array }>('SELECT name_id, hood_id, geom FROM street_part WHERE hood_id IS NOT NULL')) {
      const row = rows.get(part.hood_id as number);
      if (!row) continue;
      (streetSets.get(part.hood_id as number) ?? streetSets.set(part.hood_id as number, new Set()).get(part.hood_id as number) as Set<number>).add(part.name_id);
      row.streetKm += decodeLines(part.geom).reduce((t, l) => t + lineLengthM(l as LngLat[]), 0) / 1000;
    }
    for (const [id, set] of streetSets) (rows.get(id) as HoodRow).streets = set.size;
    for (const r of await address.all<{ hood_id: number; n: number }>('SELECT hood_id, COUNT(*) AS n FROM address WHERE hood_id IS NOT NULL GROUP BY hood_id')) {
      const row = rows.get(r.hood_id);
      if (row) row.doors = r.n;
    }
    if (buildings) {
      const all = await buildings.all<{ lon: number; lat: number; chain: number | null; lsrc: number; id: number }>('SELECT id, lon, lat, chain, lsrc FROM building');
      const byId = new Map<number, HoodRow>();
      for (const b of all) {
        const id = index.locate(b.lon / 1e6, b.lat / 1e6);
        const row = id === null ? undefined : rows.get(id);
        if (!row) continue;
        byId.set(b.id, row);
        row.buildings++;
        if (b.chain !== null) row.linked++;
        if (b.lsrc <= 3) row.levelsKnown++;
      }
      for (const e of await buildings.all<{ building: number }>('SELECT building FROM entrance')) {
        const row = byId.get(e.building);
        if (row) row.entrances++;
      }
    }
    if (directory) for (const r of await directory.all<{ hood_id: number; n: number }>('SELECT hood_id, COUNT(*) AS n FROM poi WHERE hood_id IS NOT NULL GROUP BY hood_id')) {
      const row = rows.get(r.hood_id);
      if (row) row.pois = r.n;
    }
    const unnamed = join(WORK, 'unnamed', `${plate}.jsonl`);
    if (existsSync(unnamed)) {
      for (const line of readFileSync(unnamed, 'utf8').split('\n')) {
        if (!line) continue;
        const road = JSON.parse(line) as { lines: LngLat[][] };
        const first = road.lines[0];
        const mid = first?.[Math.floor(first.length / 2)];
        const id = mid ? index.locate(mid[0], mid[1]) : null;
        const row = id === null ? undefined : rows.get(id);
        if (row) row.unnamedRoads++;
      }
    }
    for (const row of rows.values()) {
      row.streetKm = Math.round(row.streetKm * 10) / 10;
      row.doorsPerBuilding = row.buildings === 0 ? 0 : Math.round((row.doors / row.buildings) * 1000) / 1000;
      row.linkedShare = row.buildings === 0 ? 0 : Math.round((row.linked / row.buildings) * 1000) / 1000;
      row.score = scoreOf(row);
      row.weak = weakOf(row);
      row.level = levelOf(row);
    }
    return [...rows.values()].sort((a, b) => a.hoodId - b.hoodId);
  } finally {
    await address.close();
    await buildings?.close();
    await directory?.close();
  }
}

export function summaryOf(all: HoodRow[][]): string {
  const lines: string[] = [];
  const plates = all.map((rows) => {
    const sum = (key: 'streets' | 'doors' | 'buildings' | 'linked' | 'pois' | 'unnamedRoads'): number => rows.reduce((t, r) => t + r[key], 0);
    const weak = rows.filter((r) => r.weak.length > 0);
    return { plate: rows[0]?.plate ?? '', hoods: rows.length, streets: sum('streets'), doors: sum('doors'), buildings: sum('buildings'), linked: sum('linked'), pois: sum('pois'), unnamed: sum('unnamedRoads'), weak: weak.length, weakBuildings: weak.reduce((t, r) => t + r.buildings, 0), score: rows.length === 0 ? 0 : Math.round(rows.reduce((t, r) => t + r.score * Math.max(1, r.buildings), 0) / Math.max(1, rows.reduce((t, r) => t + Math.max(1, r.buildings), 0))) };
  });
  const level = (name: string): number => all.flat().filter((r) => r.level === name).length;
  lines.push(`Düzeyler (mahalle sayısı): iyi ${level('iyi')}, orta ${level('orta')}, zayıf ${level('zayıf')}, çok zayıf ${level('çok zayıf')}, az bina (< 50) ${level('az bina')}.`, '');
  lines.push('| İl | Mahalle | Sokak | Kapı | Bina | Sokağa bağlı | İşletme | Adsız yol | Zayıf mahalle | Zayıf mahallelerde bina | Puan |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of plates) lines.push(`| ${p.plate} | ${p.hoods} | ${p.streets} | ${p.doors} | ${p.buildings} | ${p.buildings === 0 ? '-' : `%${((100 * p.linked) / p.buildings).toFixed(0)}`} | ${p.pois} | ${p.unnamed} | ${p.weak} | ${p.weakBuildings} | ${p.score} |`);
  return lines.join('\n');
}

export async function runCoverage(plates: string[]): Promise<{ all: HoodRow[][]; text: string }> {
  mkdirSync(OUT, { recursive: true });
  const all: HoodRow[][] = [];
  for (const plate of plates) {
    const rows = await coverageOf(plate);
    if (!rows) continue;
    all.push(rows);
    writeFileSync(join(OUT, `${plate}.json`), JSON.stringify(rows));
  }
  const weak = all.flat().filter((r) => r.weak.length > 0).sort((a, b) => b.buildings - a.buildings);
  writeFileSync(join(OUT, 'zayif-alanlar.csv'), ['il;ilçe;mahalle;düzey;bina;kapı;sokak;sokağa bağlı;adsız yol;puan;neden', ...weak.map((r) => [r.plate, r.district, r.hood, r.level, r.buildings, r.doors, r.streets, r.linkedShare, r.unnamedRoads, r.score, r.weak.join(', ')].join(';'))].join('\n') + '\n');
  const flat = all.flat();
  const text = ['# Kapsama haritası', '', `${all.length} il, ${flat.length} mahalle. Mahalle başına: adlı sokak ve uzunluğu, kapı (adres noktası), bina, sokağa bağlı bina, OSM kat sayılı bina, giriş, işletme (rehber), adsız yol. Mahalle sınırı poligonu olmayan mahallelerde bina ve adsız yol sayılamaz (0 görünür).`, '', 'Puan (0-100) = 0,5 × kapı yoğunluğu (bina başına 0,3 kapı = tam puan) + 0,3 × sokağa bağlı bina oranı + 0,2 × sokak uzunluğu (bina başına 20 m = tam puan). Zayıf: en az 50 bina ve puan ≤ 25, ya da en az iki neden (kapı çok az, binaların %60\'tan azı sokağa bağlı, adlı sokak yok, adsız yol adlı sokaktan çok).', '', summaryOf(all), '', `Zayıf mahalle: ${weak.length} (${weak.reduce((t, r) => t + r.buildings, 0)} bina). En çok binalı 25:`, '', '| İl | İlçe | Mahalle | Bina | Kapı | Sokak | Puan | Neden |', '|---|---|---|---|---|---|---|---|', ...weak.slice(0, 25).map((r) => `| ${r.plate} | ${r.district} | ${r.hood} | ${r.buildings} | ${r.doors} | ${r.streets} | ${r.score} | ${r.weak.join(', ')} |`), ''].join('\n');
  writeFileSync(join(OUT, 'kapsama-ozet.md'), text);
  return { all, text };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const only = process.argv.includes('--plates') ? process.argv[process.argv.indexOf('--plates') + 1]?.split(',') : null;
  const plates = only ?? Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const started = Date.now();
  runCoverage(plates).then(({ all }) => console.log(JSON.stringify({ plates: all.length, hoods: all.flat().length, weak: all.flat().filter((r) => r.weak.length > 0).length, seconds: Math.round((Date.now() - started) / 1000), out: OUT })));
}
