import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { assignNearest, grownHull, unitKeyOf } from '../pipeline/build/admin-national';
import { pointInRings, type Point, type Polygon } from '../src/core/region/geom';
import { readFileSync } from 'node:fs';
import { loadOfficial } from '../pipeline/build/admin-national-step';
import { reconcilePlate } from '../pipeline/build/admin-national';
import { createHoodIndex } from '../pipeline/build/hood-index';
import { decodeRings } from '../src/core/region/geom';
import { repoRoot } from './addr-sets';
import { loadBuildingPoints, loadSeeds } from '../pipeline/build/admin-national-step';
import { workDir } from './admin-national-build';

type Row = { id: string; level: number; parent: string | null; names: Record<string, string>; rings: Polygon[] };

type Tally = { hoods: number; buildings: number; nearest: number; covered: number; wrong: number };
type Measured = { check: string; pass: boolean; measured: string };
const pct = (a: number, b: number): string => (b === 0 ? '-' : `%${((a / b) * 100).toFixed(1)}`);
const PLATES = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
const packsDir = join(workDir(), 'packs');

const empty = (): Tally => ({ hoods: 0, buildings: 0, nearest: 0, covered: 0, wrong: 0 });

const box = (rings: Polygon[]): [number, number, number, number] => {
  let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of rings) for (const [x, y] of poly[0] ?? []) b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)];
  return b;
};
const within = (p: Point, b: [number, number, number, number]): boolean => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

async function plateTally(dir: string, plate: string, seeds: ReturnType<typeof loadSeeds>, by: Map<string, Tally>): Promise<void> {
  const admin = readFileSync(join(dir, 'admin-pack', `${plate}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
  const districts = admin.filter((r) => r.level === 6);
  const buildings = await loadBuildingPoints(dir, plate);
  for (const d of districts) {
    const hoods = admin.filter((r) => r.level === 8 && r.parent === d.id && r.rings.length > 0).map((r) => ({ r, key: unitKeyOf(r.names.tr ?? ''), box: box(r.rings) }));
    const dBox = box(d.rings);
    const local = seeds.filter((s) => within([s.lon, s.lat], dBox) && pointInRings([s.lon, s.lat], d.rings));
    const pairs: { hood: (typeof hoods)[number]; seed: (typeof seeds)[number] }[] = [];
    for (const hood of hoods) {
      const seed = local.find((s) => unitKeyOf(s.name) === hood.key && pointInRings([s.lon, s.lat], hood.r.rings));
      if (seed) pairs.push({ hood, seed });
    }
    if (pairs.length < 2) continue;
    const inside = buildings.filter((b) => within(b, dBox) && pointInRings(b, d.rings));
    const truth = new Map<Point, string>();
    for (const b of inside) {
      const h = pairs.find((p) => within(b, p.hood.box) && pointInRings(b, p.hood.r.rings));
      if (h) truth.set(b, h.hood.r.id);
    }
    const seedPts = pairs.map((p) => ({ id: p.hood.r.id, at: [p.seed.lon, p.seed.lat] as Point }));
    const assigned = assignNearest(seedPts, truth.keys());
    const hulls = new Map(seedPts.map((s) => [s.id, grownHull(assigned.get(s.id) ?? [], s.at)]));
    const nearestOf = new Map<Point, string>();
    for (const [id, list] of assigned) for (const b of list) nearestOf.set(b, id);
    for (const { hood, seed } of pairs) {
      const tally = by.get(seed.kind) ?? empty();
      by.set(seed.kind, tally);
      tally.hoods += 1;
      for (const [b, id] of truth) {
        if (id !== hood.r.id) continue;
        tally.buildings += 1;
        if (nearestOf.get(b) === id) tally.nearest += 1;
        const mine = pointInRings(b, hulls.get(id) as Polygon[]);
        if (mine) tally.covered += 1;
        else if (seedPts.some((s) => s.id !== id && pointInRings(b, hulls.get(s.id) as Polygon[]))) tally.wrong += 1;
      }
    }
  }
}


async function extentCheck(plates: string[]): Promise<Measured> {
  const seeds = loadSeeds(workDir());
  const by = new Map<string, Tally>();
  for (const plate of plates) await plateTally(workDir(), plate, seeds, by);
  const v = by.get('village') ?? empty();
  const sub = by.get('suburb') ?? empty();
  const rate = (t: Tally): number => (t.buildings === 0 ? 0 : t.covered / t.buildings);
  return {
    check: 'extent',
    pass: rate(v) >= 0.75 && rate(sub) >= 0.65,
    measured: `OSM çokgeni gizlenip yerleşim noktasından türetilince bina doğru alanda: köy ${pct(v.covered, v.buildings)} (${v.hoods} mahalle), mahalle noktası ${pct(sub.covered, sub.buildings)} (${sub.hoods}); yanlış alanda köy ${pct(v.wrong, v.buildings)}, mahalle ${pct(sub.wrong, sub.buildings)}`,
  };
}

function packCounts(plate: string): { sources: Record<number, number>; official: number; positioned: number; officialPositioned: number; hoods: number } {
  const db = new DatabaseSync(join(packsDir, plate, 'address.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT source, official, (poly IS NOT NULL OR cx IS NOT NULL) AS pos FROM neighbourhood').all() as { source: number; official: number; pos: number }[];
    const sources: Record<number, number> = {};
    let official = 0;
    let positioned = 0;
    let officialPositioned = 0;
    for (const r of rows) {
      sources[r.source] = (sources[r.source] ?? 0) + 1;
      if (r.pos) positioned += 1;
      if (r.official > 0) official += 1;
      if (r.official > 0 && r.pos) officialPositioned += 1;
    }
    return { sources, official, positioned, officialPositioned, hoods: rows.length };
  } finally {
    db.close();
  }
}

function unitsCheck(plates: string[]): Measured {
  const total = { official: 0, listed: 0, positioned: 0, officialPositioned: 0, hoods: 0 };
  const sources: Record<number, number> = {};
  const lost: string[] = [];
  for (const plate of plates) {
    const stats = JSON.parse(readFileSync(join(workDir(), 'admin-national-stats', `${plate}.json`), 'utf8')) as { officialUnits: number; unmatchedDistricts: string[] };
    const c = packCounts(plate);
    total.listed += stats.officialUnits;
    total.official += c.official;
    total.positioned += c.positioned;
    total.officialPositioned += c.officialPositioned;
    total.hoods += c.hoods;
    for (const [k, v] of Object.entries(c.sources)) sources[Number(k)] = (sources[Number(k)] ?? 0) + v;
    if (stats.unmatchedDistricts.length > 0) lost.push(`${plate}:${stats.unmatchedDistricts.join('/')}`);
  }
  const listedCovered = total.official / total.listed;
  return {
    check: 'units',
    pass: listedCovered >= 0.98,
    measured: `resmî listede ${total.listed} birim, pakette ${total.official} (${pct(total.official, total.listed)}); konumu olan resmî birim ${pct(total.officialPositioned, total.official)}; toplam mahalle/köy ${total.hoods}, konumlu ${pct(total.positioned, total.hoods)}; kaynak: ${Object.entries(sources).map(([k, v]) => `${k}=${v}`).join(' ')}; eşleşmeyen ilçe ${lost.length > 0 ? lost.join(' ') : 'yok'}`,
  };
}

function buildingsCheck(plates: string[]): Measured {
  let total = 0;
  let withHood = 0;
  let osmOnly = 0;
  for (const plate of plates) {
    const file = join(packsDir, plate, 'buildings2.sqlite');
    if (!existsSync(file)) continue;
    const address = new DatabaseSync(join(packsDir, plate, 'address.sqlite'), { readOnly: true });
    const polys = (address.prepare('SELECT id, source, cx, cy, poly FROM neighbourhood WHERE poly IS NOT NULL AND source = 0').all() as { id: number; source: number; cx: number | null; cy: number | null; poly: Uint8Array }[]).map((r) => ({ id: r.id, source: r.source, rings: decodeRings(r.poly), center: null }));
    address.close();
    const osm = createHoodIndex(polys);
    const db = new DatabaseSync(file, { readOnly: true });
    for (const r of db.prepare('SELECT lon, lat, hood FROM building').all() as { lon: number; lat: number; hood: number | null }[]) {
      total += 1;
      if (r.hood !== null) withHood += 1;
      if (osm.at(r.lon / 1e6, r.lat / 1e6) !== null) osmOnly += 1;
    }
    db.close();
  }
  return { check: 'buildings', pass: total > 0 && withHood / total >= 0.7 && withHood > osmOnly, measured: `bina ${total}: mahallesi olan ${pct(withHood, total)} (yalnız OSM çokgeniyle ${pct(osmOnly, total)})` };
}

function idsCheck(plates: string[]): Measured {
  const official = loadOfficial(repoRoot);
  let units = 0;
  let different = 0;
  let duplicate = 0;
  for (const plate of plates) {
    const db = new DatabaseSync(join(packsDir, plate, 'address.sqlite'), { readOnly: true });
    const sids = (db.prepare('SELECT sid FROM neighbourhood').all() as { sid: string | null }[]).map((r) => r.sid);
    db.close();
    units += sids.length;
    const seen = new Set<string>();
    for (const sid of sids) {
      if (sid === null || seen.has(sid)) duplicate += 1;
      else seen.add(sid);
    }
    const rows = readFileSync(join(workDir(), 'admin-national', `${plate}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { sid: string; hood?: string });
    const admin = readFileSync(join(workDir(), 'admin-pack', `${plate}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row);
    const districts = admin.filter((r) => r.level === 6).map((r) => ({ id: r.id, name: r.names.tr ?? Object.values(r.names)[0] ?? r.id, rings: r.rings }));
    const ids = new Set(districts.map((d) => d.id));
    const hoods = admin.filter((r) => r.level === 8 && ids.has(r.parent as string)).map((r) => ({ id: r.id, district: r.parent as string, name: r.names.tr ?? Object.values(r.names)[0] ?? r.id, rings: r.rings }));
    const again = reconcilePlate({ plate, districts, hoods, official: official[plate] ?? {}, seeds: [] });
    const first = new Set(rows.filter((r) => r.hood === undefined).map((r) => r.sid));
    for (const u of again.units) if (!first.has(u.sid)) different += 1;
  }
  return { check: 'ids', pass: duplicate === 0 && different === 0, measured: `${units} birimde yinelenen ya da boş kimlik ${duplicate}; ikinci uzlaştırmada farklı kimlik ${different}` };
}

async function main(): Promise<void> {
  const check = process.argv.find((a) => a.startsWith('--check='))?.slice(8) ?? 'extent';
  const arg = process.argv.find((a) => a.startsWith('--plates='))?.slice(9);
  const plates = arg ? arg.split(',') : check === 'extent' ? ['16', '41', '35', '06', '07', '42', '33', '27'] : PLATES;
  const result = check === 'extent' ? await extentCheck(plates) : check === 'units' ? unitsCheck(plates) : check === 'buildings' ? buildingsCheck(plates) : idsCheck(plates);
  console.log(JSON.stringify(result));
}

void main();
