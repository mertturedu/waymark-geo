import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { sameStreetName } from '../pipeline/build/street-names';
import { decodeLine } from '../src/core/region/geom';
import { streetKey } from '../src/core/text/street';
import { recordMeasure } from '../tools/compare/measures';
import { repoRoot } from './addr-sets';
import { readChains } from './addr-buildings-eval';
import { addressPackOf } from './build-buildings-v2';

export type Slim = { lon: number; lat: number; ring: [number, number][]; chain: number | null; comp: number | null; chain2: number | null; chain3: number | null; side: number | null; seq: number | null };

export type Quality = { buildings: number; linked: number; doors: number; reachable: number; first: number; firstOrSecond: number; topThree: number; strictFirst: number; sideDoors: number; sideConsistent: number; corner: number };

const inRing = (p: [number, number], ring: [number, number][]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as [number, number];
    const b = ring[j] as [number, number];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

export function qualityOf(rows: Slim[], pack: ReturnType<typeof readChains>): Quality {
  const cell = 0.0005;
  const grid = new Map<string, Slim[]>();
  for (const r of rows) {
    if (r.chain === null) continue;
    const k = `${Math.floor(r.lon / cell)}:${Math.floor(r.lat / cell)}`;
    const list = grid.get(k);
    if (list) list.push(r);
    else grid.set(k, [r]);
  }
  const ids = new Set(pack.chains.map((c) => c.id));
  const keys = new Set(pack.chains.map((c) => streetKey(c.name).bare.key));
  const q: Quality = { buildings: rows.length, linked: rows.filter((r) => r.chain !== null).length, doors: 0, reachable: 0, first: 0, firstOrSecond: 0, topThree: 0, strictFirst: 0, sideDoors: 0, sideConsistent: 0, corner: 0 };
  const sides = new Map<string, { odd: number; even: number }>();
  for (const d of pack.doors) {
    const cx = Math.floor(d.lon / cell);
    const cy = Math.floor(d.lat / cell);
    let best: Slim | null = null;
    for (let dx = -1; dx <= 1 && !best; dx++) for (let dy = -1; dy <= 1 && !best; dy++) {
      for (const r of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        if (inRing([d.lon, d.lat], r.ring)) {
          best = r;
          break;
        }
      }
    }
    if (!best) continue;
    q.doors++;
    const doorName = pack.names.get(d.street) ?? '';
    const same = (c: number | null): boolean => c !== null && (c === d.street || sameStreetName(pack.names.get(c) ?? '', doorName));
    if (ids.has(d.street) || keys.has(streetKey(doorName).bare.key)) q.reachable++;
    if (best.chain === d.street) q.strictFirst++;
    if (same(best.chain)) q.first++;
    if (same(best.chain) || same(best.chain2)) q.firstOrSecond++;
    if (same(best.chain) || same(best.chain2) || same(best.chain3)) q.topThree++;
    if (d.parity !== null && same(best.chain) && best.seq !== null) {
      q.sideDoors++;
      const e = sides.get(`${best.comp}:${best.side}`) ?? { odd: 0, even: 0 };
      if (d.parity === 1) e.odd++;
      else e.even++;
      sides.set(`${best.comp}:${best.side}`, e);
    }
  }
  for (const e of sides.values()) q.sideConsistent += Math.max(e.odd, e.even);
  q.corner = rows.filter((r) => r.chain2 !== null).length;
  return q;
}

export function readSlim(file: string): Slim[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT lon, lat, ring, chain, comp, chain2, chain3, side, seq FROM building').all() as { lon: number; lat: number; ring: Uint8Array; chain: number | null; comp: number | null; chain2: number | null; chain3: number | null; side: number | null; seq: number | null }[]).map((r) => ({ lon: r.lon / 1e6, lat: r.lat / 1e6, ring: decodeLine(r.ring) as [number, number][], chain: r.chain, comp: r.comp, chain2: r.chain2, chain3: r.chain3, side: r.side, seq: r.seq }));
  } finally {
    db.close();
  }
}

const pct = (a: number, b: number): number => Number(((100 * a) / Math.max(1, b)).toFixed(1));

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34').split(',');
  const out: Record<string, unknown> = {};
  for (const plate of plates) {
    const rows = readSlim(join(repoRoot, 'dist', 'eval-packs', 's5', plate, 'buildings2.sqlite'));
    const q = qualityOf(rows, readChains(plate, addressPackOf(plate)));
    out[plate] = { buildings: q.buildings, linked: pct(q.linked, q.buildings), doors: q.doors, reachableDoors: q.reachable, chainFirst: pct(q.first, q.reachable), chainFirstStrictId: pct(q.strictFirst, q.reachable), chainFirstOrSecond: pct(q.firstOrSecond, q.reachable), chainTopThree: pct(q.topThree, q.reachable), side: pct(q.sideConsistent, q.sideDoors), sideDoors: q.sideDoors, cornerLinks: pct(q.corner, q.linked) };
    console.log(plate, JSON.stringify(out[plate]));
  }
  recordMeasure('a5_quality', out);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
