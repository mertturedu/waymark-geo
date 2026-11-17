import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import type { SqlDb } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { createRouter } from '../src/core/route/router';
import { createNodePackStore, createNodeRouteStore } from '../src/node/pack-store';
import { randomOf } from './measure-route';
import { PRIORITY, repoRoot } from './measure-address';

export type RouteItem = { id: string; plate: string; from: LngLat; to: LngLat; sdk: { distanceM: number; durationS: number; path: LngLat[] } };

export const TOTAL = 200;
export const MIN_M = 1000;
export const MAX_M = 25_000;

export function pickPairs(points: LngLat[], count: number, seed: number, minM = MIN_M, maxM = MAX_M): [LngLat, LngLat][] {
  const rnd = randomOf(seed);
  const pairs: [LngLat, LngLat][] = [];
  for (let tries = 0; tries < count * 200 && pairs.length < count && points.length > 1; tries++) {
    const a = points[Math.floor(rnd() * points.length)] as LngLat;
    const b = points[Math.floor(rnd() * points.length)] as LngLat;
    const apart = distanceM(a, b);
    if (apart >= minM && apart <= maxM) pairs.push([a, b]);
  }
  return pairs;
}

export const sharePerPlate = (plates: number, total = TOTAL): number[] => Array.from({ length: plates }, (_, i) => Math.floor(total / plates) + (i < total % plates ? 1 : 0));

async function run(out: string, plates: string[], total: number, seed: number): Promise<void> {
  const packs = join(repoRoot, 'dist', 'packs');
  const borders = createBorders(new Uint8Array(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))));
  const router = createRouter({ store: await createNodeRouteStore(packs), borders });
  const addresses = await createNodePackStore(packs);
  const items: RouteItem[] = [];
  const shares = sharePerPlate(plates.length, total);
  let skipped = 0;
  for (const [index, plate] of plates.entries()) {
    const db = (await addresses.open(plate)) as SqlDb;
    const rows = await db.all<{ lon: number; lat: number }>('SELECT lon, lat FROM address WHERE id % 53 = 0 ORDER BY id');
    await db.close();
    const points = rows.map((r): LngLat => [r.lon / 1e6, r.lat / 1e6]);
    const wanted = shares[index] as number;
    let kept = 0;
    for (const [from, to] of pickPairs(points, wanted * 4, seed + Number(plate))) {
      if (kept >= wanted) break;
      const got = await router.route(from, to);
      if (!got.ok) {
        skipped += 1;
        continue;
      }
      items.push({ id: `${plate}-${kept}`, plate, from, to, sdk: { distanceM: got.distanceM, durationS: got.durationS, path: got.geometry } });
      kept += 1;
    }
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(items));
  console.log(JSON.stringify({ written: out, items: items.length, skipped }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = (name: string): string | undefined => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  const out = flag('--out');
  if (!out) {
    console.error('kullanım: --out <dosya> [--plates 06,34|all] [--total N] [--seed N]');
    process.exit(2);
  }
  const wanted = flag('--plates');
  const plates = wanted === undefined ? PRIORITY : wanted === 'all' ? Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0')) : wanted.split(',');
  run(out, plates, Number(flag('--total') ?? TOTAL), Number(flag('--seed') ?? 2026)).then(() => process.exit(0));
}
