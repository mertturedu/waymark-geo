import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import type { LngLat } from '../src/core/geo/cells';
import { openRegion } from '../src/core/address/pack';
import { predictNumber, type Variant } from '../src/core/address/predict';
import { createNodePackStore } from '../src/node/pack-store';
import { linearBaseline } from '../test/reference/linear';

export type AddressPoint = { id: number; streetId: number; districtId: number; hoodId: number | null; num: number; parity: 0 | 1; lng: number; lat: number };
export type Stats = { count: number; median: number; p90: number };
type Rng = () => number;

function seeded(seed: number): Rng {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle<T>(list: T[], seed: number): T[] {
  const rng = seeded(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function pickTargets(rows: AddressPoint[], limit: number, seed: number): { both: AddressPoint[]; oneSided: AddressPoint[]; alone: AddressPoint[] } {
  const groups = new Map<string, AddressPoint[]>();
  for (const r of rows) {
    const key = `${r.streetId}:${r.districtId}:${r.parity}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const both: AddressPoint[] = [];
  const oneSided: AddressPoint[] = [];
  const alone: AddressPoint[] = [];
  for (const group of groups.values()) {
    const counts = new Map<number, number>();
    for (const r of group) counts.set(r.num, (counts.get(r.num) ?? 0) + 1);
    for (const r of group) {
      if ((counts.get(r.num) as number) > 1) continue;
      const lower = group.some((o) => o.num < r.num);
      const upper = group.some((o) => o.num > r.num);
      if (lower && upper) both.push(r);
      else if (lower || upper) oneSided.push(r);
      else alone.push(r);
    }
  }
  const order = (list: AddressPoint[]): AddressPoint[] => list.sort((a, b) => a.id - b.id);
  return { both: shuffle(order(both), seed).slice(0, limit), oneSided: shuffle(order(oneSided), seed).slice(0, limit), alone: order(alone).slice(0, limit) };
}

export function summarize(values: number[]): Stats {
  if (values.length === 0) return { count: 0, median: 0, p90: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => {
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (position - low);
  };
  return { count: values.length, median: Math.round(at(0.5) * 10) / 10, p90: Math.round(at(0.9) * 10) / 10 };
}

type PerProvince = Record<string, { A: Stats; B: Stats; C: Stats; base: Stats }>;

export function chooseVariant(perProvince: PerProvince): { variant: Variant; reason: string } {
  const plates = Object.keys(perProvince);
  const pooled = (key: Variant): number => plates.reduce((sum, p) => sum + (perProvince[p]![key].median * perProvince[p]![key].count), 0) / Math.max(1, plates.reduce((sum, p) => sum + perProvince[p]![key].count, 0));
  const ranked = (['A', 'B', 'C'] as Variant[]).sort((a, b) => pooled(a) - pooled(b));
  const best = ranked[0] as Variant;
  if (best === 'A') return { variant: 'A', reason: 'A has the smallest pooled median' };
  const worse = plates.filter((p) => perProvince[p]![best].median > perProvince[p]!.base.median || perProvince[p]![best].p90 > perProvince[p]!.base.p90);
  if (worse.length > 0) return { variant: 'A', reason: `${best} is smaller overall but worse than the baseline in ${worse.join(', ')}` };
  if (pooled(best) >= pooled('A')) return { variant: 'A', reason: `${best} is not better than A` };
  return { variant: best, reason: `${best} has the smallest pooled median and is never worse than the baseline` };
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PRIORITY = ['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59'];

async function run(): Promise<void> {
  const store = await createNodePackStore(join(repoRoot, 'dist', 'packs'));
  const perProvince: PerProvince = {};
  const oneSided: Record<string, Stats> = {};
  const lines: string[] = ['# Faz 3 numara tahmini deneyi', '', 'Her ilde iki yanında aynı sıradan komşusu olan en çok 2.000 adres tek tek gizlenir; A, B, C ve karşılaştırma tabanı aynı kümede ölçülür (metre).', '', '| İl | Adet | A ortanca | A p90 | B ortanca | B p90 | C ortanca | C p90 | Taban ortanca | Taban p90 | Tek yanlı ortanca |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const plate of PRIORITY.sort()) {
    const db = await store.open(plate);
    if (!db) continue;
    const region = await openRegion(db);
    const raw = await db.all<{ id: number; street_id: number; district_id: number; hood_id: number | null; num: number; parity: number; lon: number; lat: number }>('SELECT id, street_id, district_id, hood_id, num, parity, lon, lat FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL AND parity IS NOT NULL ORDER BY id');
    const rows: AddressPoint[] = raw.map((r) => ({ id: r.id, streetId: r.street_id, districtId: r.district_id, hoodId: r.hood_id, num: r.num, parity: r.parity as 0 | 1, lng: r.lon / 1e6, lat: r.lat / 1e6 }));
    const picked = pickTargets(rows, 2000, 2026);
    const errors: Record<string, number[]> = { A: [], B: [], C: [], base: [] };
    for (const t of picked.both) {
      const truth: LngLat = [t.lng, t.lat];
      const street = { id: t.streetId, hoodId: t.hoodId, districtId: t.districtId };
      const number = { int: t.num, key: String(t.num), parity: t.parity };
      const exclude = new Set([t.id]);
      const parts = await region.partsOf(t.streetId);
      for (const variant of ['A', 'B', 'C'] as Variant[]) {
        const p = await predictNumber(region, street, number, { variant, exclude, parts });
        if (p && p.precision === 'interpolated') errors[variant]!.push(distanceM(p.coordinate, truth));
      }
      const neighbours = rows.filter((r) => r.streetId === t.streetId && r.districtId === t.districtId && r.parity === t.parity && r.id !== t.id).map((r) => ({ int: r.num, point: [r.lng, r.lat] as LngLat }));
      const lowerPoint = neighbours.filter((n) => n.int < t.num).sort((a, b) => b.int - a.int)[0];
      const lineSet = parts.flatMap((p) => p.lines).filter((l) => l.length >= 2);
      const line = lineSet.sort((a, b) => (lowerPoint ? distanceM(a[0] as LngLat, lowerPoint.point) - distanceM(b[0] as LngLat, lowerPoint.point) : 0))[0];
      const base = line ? linearBaseline(neighbours, line, t.num) : null;
      if (base) errors.base!.push(distanceM(base, truth));
    }
    const one: number[] = [];
    for (const t of picked.oneSided) {
      const p = await predictNumber(region, { id: t.streetId, hoodId: t.hoodId, districtId: t.districtId }, { int: t.num, key: String(t.num), parity: t.parity }, { exclude: new Set([t.id]) });
      if (p && p.precision === 'interpolated') one.push(distanceM(p.coordinate, [t.lng, t.lat]));
    }
    perProvince[plate] = { A: summarize(errors.A!), B: summarize(errors.B!), C: summarize(errors.C!), base: summarize(errors.base!) };
    oneSided[plate] = summarize(one);
    const s = perProvince[plate]!;
    lines.push(`| ${plate} | ${s.A.count} | ${s.A.median} | ${s.A.p90} | ${s.B.median} | ${s.B.p90} | ${s.C.median} | ${s.C.p90} | ${s.base.median} | ${s.base.p90} | ${oneSided[plate]!.median} |`);
    await db.close();
  }
  const choice = chooseVariant(perProvince);
  lines.push('', `Seçilen varyant: **${choice.variant}**. ${choice.reason}.`);
  const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
  mkdirSync(join(dir, 'faz-3-kararlar'), { recursive: true });
  writeFileSync(join(dir, 'faz-3-tahmin-deneyi.md'), lines.join('\n') + '\n');
  writeFileSync(join(dir, 'faz-3-kararlar', 'tahmin-varyanti.json'), JSON.stringify({ ...choice, perProvince, oneSided }, null, 1) + '\n');
  console.log(lines.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
