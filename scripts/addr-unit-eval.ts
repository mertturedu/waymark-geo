import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { openBuildings2, type BuildingInfo } from '../src/core/address/buildings2';
import { estimateFloor, resolveBlock, resolveUnit, unitsPerFloor } from '../src/core/address/unit';
import { nameKey } from '../src/core/text';
import { openSqlite } from '../src/node/sqlite';
import { libpostal } from '../tools/compare/engines/libpostal';
import { recordMeasure } from '../tools/compare/measures';
import { COMPONENTS, evaluate, fromParts, prf, type Component, type Evaluated } from './addr-parse-eval';
import { readSet, repoRoot, seeded, type TextRecord } from './addr-sets';

const PLATES = ['06', '16', '34', '35', '41'];
const POOL = 4000;
const pct = (value: number): number => Number((100 * value).toFixed(1));

type Row = { id: number; lon: number; lat: number; area: number; levels: number; lsrc: number; name: string | null };

function levelled(plate: string, pack: string): Row[] {
  const db = new DatabaseSync(join(repoRoot, 'dist', 'eval-packs', pack, plate, 'buildings2.sqlite'), { readOnly: true });
  try {
    return db.prepare('SELECT id, lon, lat, area, levels, lsrc, name FROM building WHERE lsrc IN (1, 2) AND levels BETWEEN 2 AND 20 AND area BETWEEN 120 AND 1500 ORDER BY id').all() as Row[];
  } finally {
    db.close();
  }
}

const asBuilding = (r: Row): BuildingInfo => ({
  id: r.id, gid: '', center: [r.lon / 1e6, r.lat / 1e6], areaM2: r.area, levels: r.levels, levelsSource: r.lsrc === 1 ? 'num_floors' : 'osm', heightM: null, name: r.name,
  chain: null, part: null, side: null, distanceM: null, along: null, sequence: null, secondChain: null, thirdChain: null, ring: [],
});

type Flat = { building: BuildingInfo; floor: number; door: number; perFloor: number };

function flats(pack: string, seed: number): Flat[] {
  const rng = seeded(seed);
  const out: Flat[] = [];
  for (const plate of PLATES) {
    const rows = levelled(plate, pack);
    for (let i = 0; i < Math.min(POOL, rows.length); i++) {
      const r = rows[Math.floor(rng() * rows.length)] as Row;
      const flat = 80 + rng() * 90;
      const perFloor = Math.max(1, Math.min(8, Math.round(r.area / flat)));
      const floor = Math.floor(rng() * r.levels);
      out.push({ building: asBuilding(r), floor, door: floor * perFloor + 1 + Math.floor(rng() * perFloor), perFloor });
    }
  }
  return out;
}

function checkFloor(pack: string): void {
  const all = flats(pack, 7);
  let exact = 0;
  let near = 0;
  let inside = 0;
  for (const f of all) {
    const model = estimateFloor(f.door, unitsPerFloor(f.building.areaM2));
    const gap = Math.abs(model.value - f.floor);
    if (gap === 0) exact++;
    if (gap <= 1) near++;
    if (f.floor >= model.low && f.floor <= model.high) inside++;
  }
  const result = { count: all.length, exact: pct(exact / all.length), within1: pct(near / all.length), inRange: pct(inside / all.length) };
  console.log(`kat tahmini (sentetik, geçici): ${all.length} daire, tam %${result.exact}, ±1 %${result.within1}, aralık içinde %${result.inRange}`);
  recordMeasure('a7_floor', { ...result, synthetic: true });
}

const resolve = (f: Flat, floor: number | null, door: number): string[] => resolveUnit({ floor: floor === null ? null : String(floor), door: String(door), block: null }, f.building, [], () => []).notes;

function checkNotes(pack: string): void {
  const all = flats(pack, 11);
  const rng = seeded(13);
  const kinds: Record<string, { caught: number; total: number }> = { floor_out_of_range: { caught: 0, total: 0 }, door_out_of_range: { caught: 0, total: 0 }, floor_door_mismatch: { caught: 0, total: 0 } };
  let falseNotes = 0;
  for (const f of all) {
    if (resolve(f, f.floor, f.door).length > 0) falseNotes++;
    const per = unitsPerFloor(f.building.areaM2);
    const high = f.building.levels + 2 + Math.floor(rng() * 6);
    kinds.floor_out_of_range!.total++;
    if (resolve(f, high, f.door).length > 0) kinds.floor_out_of_range!.caught++;
    const far = f.building.levels * per * 2 + 5 + Math.floor(rng() * 25);
    kinds.door_out_of_range!.total++;
    if (resolve(f, null, far).length > 0) kinds.door_out_of_range!.caught++;
    const up = f.floor + 3 + Math.floor(rng() * 3);
    const down = f.floor - 3 - Math.floor(rng() * 3);
    const wrong = up < f.building.levels ? up : down >= 0 ? down : null;
    if (wrong === null) continue;
    kinds.floor_door_mismatch!.total++;
    if (resolve(f, wrong, f.door).length > 0) kinds.floor_door_mismatch!.caught++;
  }
  const total = Object.values(kinds).reduce((a, k) => a + k.total, 0);
  const caught = Object.values(kinds).reduce((a, k) => a + k.caught, 0);
  const result = { consistent: all.length, falseRate: pct(falseNotes / all.length), caughtRate: pct(caught / total), kinds: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, pct(v.caught / v.total)])) };
  console.log(`tutarsızlık notları (sentetik): tutarlı ${all.length} kayıtta yanlış not %${result.falseRate}; enjekte ${total} tutarsızlıkta yakalama %${result.caughtRate}`, result.kinds);
  recordMeasure('a7_notes', { ...result, synthetic: true });
}

async function checkBlock(pack: string): Promise<void> {
  const rng = seeded(17);
  let tried = 0;
  let right = 0;
  let ambiguous = 0;
  let ambiguousRight = 0;
  const sites = new Set<string>();
  for (const plate of PLATES) {
    const reader = await openBuildings2(openSqlite(join(repoRoot, 'dist', 'eval-packs', pack, plate, 'buildings2.sqlite')));
    const db = new DatabaseSync(join(repoRoot, 'dist', 'eval-packs', pack, plate, 'buildings2.sqlite'), { readOnly: true });
    const named = (db.prepare("SELECT id, lon, lat, name FROM building WHERE name LIKE '%blok%' OR name LIKE '%block%' ORDER BY id").all() as { id: number; lon: number; lat: number; name: string }[]).filter(() => rng() < 0.6).slice(0, 1500);
    db.close();
    for (const b of named) {
      const center: [number, number] = [b.lon / 1e6, b.lat / 1e6];
      const around = await reader.near(center, 150, 80);
      const self = around.find((c) => c.building.id === b.id);
      const others = around.filter((c) => c.building.id !== b.id);
      const peers = others.filter((c) => c.building.name !== null && nameKey(c.building.name) === nameKey(b.name) && c.distanceM <= 150);
      const nearBlocks = others.filter((c) => c.building.name !== null && /blok|block/i.test(c.building.name));
      if (!self || nearBlocks.length === 0) continue;
      const base = others[0]?.building as BuildingInfo;
      const found = resolveBlock(b.name, base, around.map((c) => c.building));
      tried++;
      sites.add(`${plate}:${Math.round(center[0] * 400)}:${Math.round(center[1] * 400)}`);
      if (peers.length > 0) {
        ambiguous++;
        if (found?.id === b.id) ambiguousRight++;
      } else if (found?.id === b.id) right++;
    }
  }
  const clear = tried - ambiguous;
  const result = { tried, clear, rate: pct(right / Math.max(1, clear)), ambiguous, ambiguousRate: pct(ambiguousRight / Math.max(1, ambiguous)), sites: sites.size };
  console.log(`blok çözümleme: ${clear} net kayıtta %${result.rate} (${sites.size} küme); aynı adlı komşusu olan ${ambiguous} kayıtta %${result.ambiguousRate}`);
  recordMeasure('a7_block', result);
}

const digits = (value: string | undefined): string | null => (value ? (/\d+/.exec(value)?.[0] ?? null) : null);

async function checkParse(limit: number): Promise<void> {
  const records: TextRecord[] = [];
  for (const plate of ['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59']) records.push(...readSet<TextRecord>('g9', plate).slice(0, limit));
  const rows = evaluate(records);
  const sdk = Object.fromEntries((['floor', 'door', 'block'] as Component[]).map((c) => [c, pct(prf(rows, c, 'best').f1)]));
  const engine = libpostal();
  const peers = evaluate(records, () => fromParts({}));
  for (let i = 0; i < records.length; i++) {
    const record = records[i] as TextRecord;
    const parts = (await engine.query(record.text)).parts;
    const variant = fromParts({ ...parts, ...(parts.floor ? { floor: digits(parts.floor) ?? parts.floor } : {}), ...(parts.door ? { door: digits(parts.door) ?? parts.door } : {}) });
    const peer = peers[i] as Evaluated;
    peer.parsed = variant;
    peer.bestVariant = variant;
    peer.primary = (await import('./addr-parse-eval')).correctOf(variant, record);
    peer.best = peer.primary;
  }
  const peer = Object.fromEntries((['floor', 'door', 'block'] as Component[]).map((c) => [c, pct(prf(peers, c, 'primary').f1)]));
  console.log(`birim ayrıştırma (G9, ${records.length} kayıt): SDK`, sdk, 'libpostal', peer);
  void COMPONENTS;
  recordMeasure('a7_parse', { count: records.length, sdk, libpostal: peer });
}

async function main(): Promise<void> {
  const check = process.argv[2] ?? 'all';
  const pack = process.env.BUILD2_PACK ?? 's5';
  if (check === 'parse' || check === 'all') await checkParse(Number(process.argv[3] ?? 150));
  if (check === 'floor' || check === 'all') checkFloor(pack);
  if (check === 'notes' || check === 'all') checkNotes(pack);
  if (check === 'block' || check === 'all') await checkBlock(pack);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
