import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { componentsOf, indexOf, link, metres, sequence, type Chain, type Link, type Pt, type Trace } from '../pipeline/build/building-link';
import { decodeLines } from '../src/core/region/geom';
import { streetKey } from '../src/core/text/street';
import { recordMeasure } from '../tools/compare/measures';
import { packsDir, repoRoot } from './addr-sets';

export function readChains(plate: string, packFile?: string): { chains: Chain[]; doors: { street: number; lon: number; lat: number; parity: number | null; num: number | null }[]; names: Map<number, string> } {
  const dir = join(packsDir(), plate);
  const file = packFile ?? join(dir, readdirSync(dir).find((f) => f.startsWith('address-') && f.endsWith('.sqlite')) as string);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const names = new Map((db.prepare('SELECT id, name FROM street_name').all() as { id: number; name: string }[]).map((r) => [r.id, r.name]));
    const lines = new Map<number, Pt[][]>();
    for (const row of db.prepare('SELECT name_id, geom FROM street_part').all() as { name_id: number; geom: Uint8Array }[]) {
      lines.set(row.name_id, [...(lines.get(row.name_id) ?? []), ...(decodeLines(row.geom) as Pt[][])]);
    }
    const chains = [...lines].map(([id, l]) => ({ id, name: names.get(id) ?? '', lines: l }));
    const doors = (db.prepare('SELECT street_id, lon, lat, parity, num FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL').all() as { street_id: number; lon: number; lat: number; parity: number | null; num: number | null }[]).map((r) => ({ street: r.street_id, lon: r.lon / 1e6, lat: r.lat / 1e6, parity: r.parity, num: r.num }));
    return { chains, doors, names };
  } finally {
    db.close();
  }
}

export type Stats = { buildings: number; linked: number; doors: number; nameAgree: number; sideDoors: number; sideConsistent: number; corner: number };

export function measure(traces: Trace[], pack: ReturnType<typeof readChains>): { stats: Stats; links: Map<string, Link> } {
  const index = indexOf(componentsOf(pack.chains));
  const links = new Map<string, Link>();
  for (const t of traces) {
    const l = link(index, t);
    if (l) links.set(t.id, l);
  }
  const ordered = traces.filter((t) => links.has(t.id));
  const cell = 0.0004;
  const grid = new Map<string, Trace[]>();
  for (const t of ordered) {
    const key = `${Math.floor(t.lon / cell)}:${Math.floor(t.lat / cell)}`;
    grid.set(key, [...(grid.get(key) ?? []), t]);
  }
  let doors = 0;
  let nameAgree = 0;
  const sides = new Map<string, { odd: number; even: number }>();
  const doorSide: { key: string; parity: number }[] = [];
  for (const d of pack.doors) {
    const cx = Math.floor(d.lon / cell);
    const cy = Math.floor(d.lat / cell);
    let best: Trace | null = null;
    let bestD = 12;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const t of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
      const m = metres([d.lon, d.lat], [t.lon, t.lat]);
      if (m < bestD) {
        bestD = m;
        best = t;
      }
    }
    if (!best) continue;
    const l = links.get(best.id) as Link;
    doors++;
    const doorKey = streetKey(pack.names.get(d.street) ?? '').key;
    const chainKey = streetKey(pack.names.get(l.chain) ?? '').key;
    const second = l.second ? streetKey(pack.names.get(l.second.chain) ?? '').key : null;
    if (doorKey === chainKey || doorKey === second) nameAgree++;
    if (d.parity !== null && doorKey === chainKey) doorSide.push({ key: `${l.component}:${l.side}`, parity: d.parity });
  }
  for (const s of doorSide) {
    const entry = sides.get(s.key) ?? { odd: 0, even: 0 };
    if (s.parity === 1) entry.odd++;
    else entry.even++;
    sides.set(s.key, entry);
  }
  let consistent = 0;
  for (const entry of sides.values()) consistent += Math.max(entry.odd, entry.even);
  const stats: Stats = { buildings: traces.length, linked: links.size, doors, nameAgree, sideDoors: doorSide.length, sideConsistent: consistent, corner: [...links.values()].filter((l) => l.second).length };
  void sequence;
  return { stats, links };
}

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '34').split(',');
  for (const plate of plates) {
    const file = join(repoRoot, 'dist', 'work', '261028', 'buildings', plate, 'buildings.jsonl');
    const traces = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string; lon: number; lat: number; area_m2: number }).map((r) => ({ id: r.id, lon: r.lon, lat: r.lat, area: r.area_m2 }));
    const pack = readChains(plate);
    const { stats } = measure(traces, pack);
    const pct = (a: number, b: number): string => (b === 0 ? '-' : `%${((100 * a) / b).toFixed(1)}`);
    console.log(plate, stats, { bağlı: pct(stats.linked, stats.buildings), zincirUyumu: pct(stats.nameAgree, stats.doors), tarafTutarlılığı: pct(stats.sideConsistent, stats.sideDoors) });
  }
  void recordMeasure;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
