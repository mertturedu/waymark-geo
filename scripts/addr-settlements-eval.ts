import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { metres, type Pt } from '../pipeline/build/building-link';
import { recordMeasure } from '../tools/compare/measures';
import { repoRoot } from './addr-sets';
import { addressPackOf } from './build-buildings-v2';

type Door = { lon: number; lat: number };

export type VillageStats = { plate: string; villages: number; median: number | null; within300: number };

const middle = (values: number[]): number | null => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : (sorted[Math.floor(sorted.length / 2)] as number);
};

const DOOR_RADIUS_M = 500;
const MIN_DOORS = 5;

export function villageStats(plate: string): VillageStats {
  const address = new DatabaseSync(addressPackOf(plate), { readOnly: true });
  const doors = (address.prepare('SELECT lon, lat FROM address WHERE street_id IS NULL').all() as { lon: number; lat: number }[]).map((r) => ({ lon: r.lon / 1e6, lat: r.lat / 1e6 }));
  address.close();
  const pack = new DatabaseSync(join(repoRoot, 'dist', 'eval-packs', 's5', plate, 'buildings2.sqlite'), { readOnly: true });
  const settlements = (pack.prepare('SELECT name, lon, lat, n FROM settlement WHERE n >= 3').all() as { name: string; lon: number; lat: number; n: number }[]).map((s) => ({ ...s, lon: s.lon / 1e6, lat: s.lat / 1e6 }));
  pack.close();
  const grid = new Map<string, Door[]>();
  for (const d of doors) {
    const k = `${Math.floor(d.lon / 0.01)}:${Math.floor(d.lat / 0.01)}`;
    grid.set(k, [...(grid.get(k) ?? []), d]);
  }
  const distances: number[] = [];
  for (const s of settlements) {
    const cx = Math.floor(s.lon / 0.01);
    const cy = Math.floor(s.lat / 0.01);
    const near: Door[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const d of grid.get(`${cx + dx}:${cy + dy}`) ?? []) if (metres([s.lon, s.lat], [d.lon, d.lat] as Pt) <= DOOR_RADIUS_M) near.push(d);
    if (near.length < MIN_DOORS) continue;
    const centre: Pt = [middle(near.map((d) => d.lon)) as number, middle(near.map((d) => d.lat)) as number];
    distances.push(metres([s.lon, s.lat], centre));
  }
  return { plate, villages: distances.length, median: middle(distances) === null ? null : Math.round(middle(distances) as number), within300: distances.filter((d) => d <= 300).length };
}

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34,35,16,06,41').split(',');
  const all = plates.map(villageStats);
  for (const s of all) console.log(s);
  const medians = all.filter((s) => s.median !== null);
  const total = medians.reduce((n, s) => n + s.villages, 0);
  const merged = total === 0 ? null : Math.round(medians.reduce((n, s) => n + (s.median as number) * s.villages, 0) / total);
  recordMeasure('a5_settlements', { plates, villages: total, median: merged, within300: medians.reduce((n, s) => n + s.within300, 0), per: all });
  console.log({ villages: total, median: merged });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
