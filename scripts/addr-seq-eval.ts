import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { openBuildings2, type BuildingInfo } from '../src/core/address/buildings2';
import { openRegion } from '../src/core/address/pack';
import { predictNumber } from '../src/core/address/predict';
import { bracketed, DEFAULT_RADIUS, predictFromBuildings, type RadiusModel } from '../src/core/address/sequence';
import { openSqlite } from '../src/node/sqlite';
import { recordMeasure } from '../tools/compare/measures';
import { pick, repoRoot, seeded } from './addr-sets';
import { addressPackOf } from './build-buildings-v2';

type Door = { id: number; street: number; district: number; hood: number | null; num: number; suffix: string; parity: number; lon: number; lat: number };

export function readDoors(file: string): Door[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT id, street_id, district_id, hood_id, num, suffix, parity, lon, lat FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL AND parity IS NOT NULL').all() as { id: number; street_id: number; district_id: number; hood_id: number | null; num: number; suffix: string; parity: number; lon: number; lat: number }[]).map((r) => ({ id: r.id, street: r.street_id, district: r.district_id, hood: r.hood_id, num: r.num, suffix: r.suffix, parity: r.parity, lon: r.lon / 1e6, lat: r.lat / 1e6 }));
  } finally {
    db.close();
  }
}

export type Sample = { bracket: boolean; street: number; same: boolean; delta: number; k: number; errorM: number; baselineM: number; radiusM: number; sideOk: boolean | null; notes: string[]; plate: string };

export async function evaluate(plate: string, pack: string, half: 'A' | 'B' | null, perStreet = 2, radius: RadiusModel = DEFAULT_RADIUS): Promise<Sample[]> {
  const doors = readDoors(addressPackOf(plate));
  const byStreet = new Map<string, Door[]>();
  for (const d of doors) if (d.suffix === '' && (half === null || (half === 'A' ? d.street % 2 === 1 : d.street % 2 === 0))) byStreet.set(`${d.street}:${d.district}`, [...(byStreet.get(`${d.street}:${d.district}`) ?? []), d]);
  const bdb = openSqlite(join(repoRoot, 'dist', 'eval-packs', pack, plate, 'buildings2.sqlite'));
  const reader = await openBuildings2(bdb);
  const adb = openSqlite(addressPackOf(plate));
  const region = await openRegion(adb);
  const rng = seeded(4711);
  const out: Sample[] = [];
  for (const [key, list] of byStreet) {
    const street = Number(key.split(':')[0]);
    const unique = [...new Map(list.map((d) => [d.num, d])).values()];
    if (unique.length < 5) continue;
    const buildings = await reader.ofStreet(street);
    if (buildings.length < 5) continue;
    const parts = await region.partsOf(street);
    for (let rep = 0; rep < perStreet; rep++) {
      const target = pick(rng, unique);
      const others = unique.filter((d) => d !== target);
      const truthBuilding: BuildingInfo | null = await reader.at([target.lon, target.lat]);
      for (const k of [1, 2, 99]) {
        const anchors = k === 99 ? others : [...others].sort(() => rng() - 0.5).slice(0, k);
        const result = predictFromBuildings({ number: target.num, anchors: anchors.map((a) => ({ number: a.num, point: [a.lon, a.lat], weight: 1 })), buildings }, { radius });
        if (!result) continue;
        const keep = new Set(anchors.map((a) => a.id));
        const exclude = new Set(list.filter((d) => !keep.has(d.id)).map((d) => d.id));
        const old = await predictNumber(region, { id: street, hoodId: target.hood, districtId: target.district }, { int: target.num, key: String(target.num), parity: target.parity as 0 | 1 }, { exclude, parts });
        out.push({ bracket: bracketed(target.num, anchors.map((a) => ({ number: a.num, point: [a.lon, a.lat], weight: 1 }))), street, same: anchors.some((a) => a.parity === target.parity), delta: Math.min(...anchors.map((a) => Math.abs(a.num - target.num))), k, plate, errorM: bracketed(target.num, anchors.map((a) => ({ number: a.num, point: [a.lon, a.lat], weight: 1 }))) && old ? distanceM(old.coordinate, [target.lon, target.lat]) : distanceM(result.building.center, [target.lon, target.lat]), baselineM: old ? distanceM(old.coordinate, [target.lon, target.lat]) : 100_000, radiusM: result.radiusM, sideOk: truthBuilding && truthBuilding.side && truthBuilding.chain === street && truthBuilding.part === result.building.part ? truthBuilding.side === result.building.side : null, notes: result.notes });
      }
    }
  }
  await bdb.close();
  await adb.close();
  return out;
}

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};
const share = (values: number[], limit: number): number => (values.length === 0 ? 0 : Math.round((1000 * values.filter((v) => v <= limit).length) / values.length) / 10);

export function summary(samples: Sample[], k: number): { n: number; median: number; p90: number; within15: number; within30: number; baselineMedian: number; baselineP90: number; side: number; coverage: number } {
  const s = samples.filter((x) => x.k === k);
  const sides = s.filter((x) => x.sideOk !== null);
  return {
    n: s.length,
    median: Math.round(quantile(s.map((x) => x.errorM), 0.5) * 10) / 10,
    p90: Math.round(quantile(s.map((x) => x.errorM), 0.9) * 10) / 10,
    within15: share(s.map((x) => x.errorM), 15),
    within30: share(s.map((x) => x.errorM), 30),
    baselineMedian: Math.round(quantile(s.map((x) => x.baselineM), 0.5) * 10) / 10,
    baselineP90: Math.round(quantile(s.map((x) => x.baselineM), 0.9) * 10) / 10,
    side: sides.length === 0 ? 0 : Math.round((1000 * sides.filter((x) => x.sideOk).length) / sides.length) / 10,
    coverage: s.length === 0 ? 0 : Math.round((1000 * s.filter((x) => x.errorM <= x.radiusM).length) / s.length) / 10,
  };
}

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '06').split(',');
  const pack = process.env.BUILD_NAME ?? 's5a';
  const all: Sample[] = [];
  for (const plate of plates) all.push(...(await evaluate(plate, pack, 'A')));
  const one = all.filter((x) => x.k === 1);
  for (const same of [true, false]) for (const [name, test] of [['Δ≤2', (x: Sample) => x.delta <= 2], ['Δ≤6', (x: Sample) => x.delta > 2 && x.delta <= 6], ['Δ≤20', (x: Sample) => x.delta > 6 && x.delta <= 20], ['Δ>20', (x: Sample) => x.delta > 20]] as const) {
    const g = one.filter((x) => x.same === same && test(x));
    if (g.length > 0) console.log('1 çapa', same ? 'aynı parite' : 'karşı parite', name, 'n', g.length, 'ortanca', Math.round(quantile(g.map((x) => x.errorM), 0.5) * 10) / 10, 'taraf', Math.round(1000 * g.filter((x) => x.sideOk).length / Math.max(1, g.filter((x) => x.sideOk !== null).length)) / 10);
  }
  const result: Record<string, unknown> = {};
  for (const k of [1, 2, 99]) {
    result[String(k)] = summary(all, k);
    console.log(k === 99 ? 'tümü' : `${k} çapa`, JSON.stringify(result[String(k)]));
  }
  if (process.argv.includes('--record')) recordMeasure('a6_g3', { plates, pack, ...result });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
