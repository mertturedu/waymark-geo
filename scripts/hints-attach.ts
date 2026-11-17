import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { LngLat } from '../src/core/geo/cells';
import { decodeLines } from '../src/core/region/geom';
import { nameKey } from '../src/core/text/fold';
import { repoRoot } from './addr-sets';
import type { StreetWay } from '../src/core/learned/types';
import type { Poi } from './hints-overture';

export type AttachOptions = { reachM: number; minPois: number; minFit: number; margin: number; pad: number };
export const ATTACH: AttachOptions = { reachM: 25, minPois: 5, minFit: 0.5, margin: 0.4, pad: Number(process.env.ATTACH_PAD ?? 150) };

export type Roads = { owners: Map<string, number[][][]>; grid: Map<string, { owner: string; x: number; y: number }[]> };
export type Attached = { owner: string; fit: number; lines: number[][][]; point: LngLat; radiusM: number };

const M = 111320;
const CELL = 0.0004;
const cellOf = (x: number, y: number): string => `${Math.floor(x / CELL)}|${Math.floor(y / CELL)}`;
const metres = (a: readonly number[], b: readonly number[]): number => Math.hypot((a[0]! - b[0]!) * Math.cos((a[1]! * Math.PI) / 180), a[1]! - b[1]!) * M;

function densify(line: number[][]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]!;
    const b = line[i + 1]!;
    const steps = Math.max(1, Math.ceil(metres(a, b) / 10));
    for (let k = 0; k < steps; k++) out.push([a[0]! + ((b[0]! - a[0]!) * k) / steps, a[1]! + ((b[1]! - a[1]!) * k) / steps]);
  }
  if (line.length > 0) out.push(line[line.length - 1]!);
  return out;
}

type Segment = { highway: string; line: number[][] };
const CHAIN_MAX_M = Number(process.env.CHAIN_MAX_M ?? 2500);
const CHAIN_TURN_DEG = 45;
const nodeKey = (q: readonly number[]): string => `${Math.round(q[0]! * 1e5)}|${Math.round(q[1]! * 1e5)}`;
const bearing = (a: readonly number[], b: readonly number[]): number => Math.atan2((b[0]! - a[0]!) * Math.cos((a[1]! * Math.PI) / 180), b[1]! - a[1]!) * (180 / Math.PI);
const turnOf = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const lengthOf = (line: readonly number[][]): number => line.reduce((s, q, i) => (i === 0 ? 0 : s + metres(line[i - 1]!, q)), 0);

export function chainOf(segments: readonly Segment[]): number[][][] {
  const ends = new Map<string, { seg: number; head: boolean }[]>();
  segments.forEach((s, i) => {
    for (const head of [true, false]) {
      const key = nodeKey(head ? s.line[0]! : s.line[s.line.length - 1]!);
      ends.set(key, [...(ends.get(key) ?? []), { seg: i, head }]);
    }
  });
  const used = new Set<number>();
  const out: number[][][] = [];
  const next = (line: number[][], highway: string, tail: boolean): { seg: number; line: number[][] } | null => {
    const node = tail ? line[line.length - 1]! : line[0]!;
    const here = ends.get(nodeKey(node)) ?? [];
    if (here.length !== 2) return null;
    const other = here.find((e) => !used.has(e.seg) && segments[e.seg]!.highway === highway);
    if (!other) return null;
    const cand = segments[other.seg]!.line;
    const oriented = other.head === tail ? cand : [...cand].reverse();
    const heading = tail ? bearing(line[line.length - 2]!, line[line.length - 1]!) : bearing(line[1]!, line[0]!);
    const entering = tail ? bearing(oriented[0]!, oriented[1]!) : bearing(oriented[oriented.length - 1]!, oriented[oriented.length - 2]!);
    if (turnOf(heading, entering) > CHAIN_TURN_DEG) return null;
    return { seg: other.seg, line: oriented };
  };
  segments.forEach((s, i) => {
    if (used.has(i)) return;
    used.add(i);
    let line = s.line;
    let metresIn = lengthOf(line);
    for (const tail of [true, false]) {
      for (;;) {
        if (metresIn >= CHAIN_MAX_M) break;
        const n = next(line, s.highway, tail);
        if (!n) break;
        used.add(n.seg);
        metresIn += lengthOf(n.line);
        line = tail ? [...line, ...n.line.slice(1)] : [...n.line.slice(0, -1), ...line];
      }
    }
    out.push(line);
  });
  return out;
}

export function roadsOf(plate: string, withNamed: boolean): Roads {
  const work = join(repoRoot, 'dist', 'work', '261028');
  const owners = new Map<string, number[][][]>();
  const grid: Roads['grid'] = new Map();
  const put = (owner: string, lines: number[][][]): void => {
    owners.set(owner, [...(owners.get(owner) ?? []), ...lines]);
    for (const line of lines) {
      for (const q of densify(line)) {
        const key = cellOf(q[0]!, q[1]!);
        const list = grid.get(key) ?? [];
        list.push({ owner, x: q[0]!, y: q[1]! });
        grid.set(key, list);
      }
    }
  };
  let index = 0;
  const file = join(work, 'unnamed', `${plate}.jsonl`);
  if (existsSync(file)) {
    const segments: Segment[] = [];
    for (const text of readFileSync(file, 'utf8').split('\n')) {
      if (!text) continue;
      const row = JSON.parse(text) as { lines: number[][][]; highway?: string };
      for (const line of row.lines) if (line.length >= 2) segments.push({ highway: row.highway ?? '', line });
    }
    if (process.env.CHAIN === '0') for (const s of segments) put(`unnamed:${index++}`, [s.line]);
    else for (const line of chainOf(segments)) put(`unnamed:${index++}`, [line]);
  }
  if (withNamed) {
    const db = new DatabaseSync(join(work, 'packs', plate, 'address.sqlite'), { readOnly: true });
    try {
      for (const r of db.prepare('SELECT n.key key, d.name district, p.geom geom FROM street_part p JOIN street_name n ON n.id = p.name_id JOIN district d ON d.id = p.district_id').all() as { key: string; district: string; geom: Uint8Array }[]) {
        try {
          put(`${nameKey(r.district)}|${r.key}`, decodeLines(r.geom) as unknown as number[][][]);
        } catch {
          continue;
        }
      }
    } finally {
      db.close();
    }
  }
  return { owners, grid };
}

export function fitsOf(roads: Roads, pois: readonly Poi[], reachM: number): [string, number][] {
  const count = new Map<string, number>();
  for (const p of pois) {
    const seen = new Set<string>();
    const cx = Math.floor(p.point[0] / CELL);
    const cy = Math.floor(p.point[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const v of roads.grid.get(`${cx + dx}|${cy + dy}`) ?? []) if (metres([v.x, v.y], p.point) <= reachM) seen.add(v.owner);
    for (const owner of seen) count.set(owner, (count.get(owner) ?? 0) + 1);
  }
  return [...count.entries()].map(([owner, n]): [string, number] => [owner, n / pois.length]).sort((a, b) => b[1] - a[1]);
}

export function attach(roads: Roads, pois: readonly Poi[], options: AttachOptions = ATTACH, allowed: (owner: string) => boolean = () => true): Attached | null {
  if (pois.length < options.minPois) return null;
  const ranked = fitsOf(roads, pois, options.reachM).filter(([owner]) => allowed(owner));
  const best = ranked[0];
  if (!best || best[1] < options.minFit) return null;
  const second = ranked[1];
  if (second && second[1] > best[1] - options.margin) return null;
  const lines = roads.owners.get(best[0]) ?? [];
  const near = pois.map((p) => {
    let at: LngLat = p.point;
    let gap = Infinity;
    for (const line of lines) for (const q of densify(line)) {
      const d = metres(q, p.point);
      if (d < gap) {
        gap = d;
        at = [q[0]!, q[1]!];
      }
    }
    return { at, gap };
  }).filter((x) => x.gap <= options.reachM);
  if (near.length === 0) return null;
  const centre: LngLat = [near.reduce((s, x) => s + x.at[0], 0) / near.length, near.reduce((s, x) => s + x.at[1], 0) / near.length];
  const extent = Math.max(...near.map((x) => metres(x.at, centre)));
  return { owner: best[0], fit: best[1], lines, point: [Math.round(centre[0] * 1e6) / 1e6, Math.round(centre[1] * 1e6) / 1e6], radiusM: Math.round(Math.max(100, extent + options.pad)) };
}

const MAX_LINE_POINTS = 60;
const MAX_DOORS = 40;

export function wayOf(lines: number[][][], pois: readonly Poi[]): StreetWay | undefined {
  if (lines.length !== 1) return undefined;
  const raw = lines[0]!;
  const stride = Math.max(1, Math.ceil(raw.length / MAX_LINE_POINTS));
  const thin = raw.filter((_, i) => i % stride === 0 || i === raw.length - 1);
  if (thin.length < 2) return undefined;
  const along = [0];
  for (let i = 1; i < thin.length; i++) along.push(along[i - 1]! + metres(thin[i - 1]!, thin[i]!));
  const doors = new Map<number, number>();
  for (const p of pois) {
    if (p.number === undefined) continue;
    let gap = Infinity;
    let at = 0;
    for (let i = 0; i + 1 < thin.length; i++) {
      const a = thin[i]!;
      const b = thin[i + 1]!;
      for (let t = 0; t <= 1; t += 0.1) {
        const d = metres([a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t], p.point);
        if (d < gap) {
          gap = d;
          at = along[i]! + (along[i + 1]! - along[i]!) * t;
        }
      }
    }
    if (gap <= 40 && !doors.has(p.number)) doors.set(p.number, Math.round(at));
  }
  if (doors.size < 4) return undefined;
  const list = [...doors.entries()].sort((a, b) => a[0] - b[0]);
  const keep = list.length > MAX_DOORS ? list.filter((_, i) => i % Math.ceil(list.length / MAX_DOORS) === 0) : list;
  return { line: thin.map((q): LngLat => [Math.round(q[0]! * 1e6) / 1e6, Math.round(q[1]! * 1e6) / 1e6]), doors: keep.map(([n, s]): [number, number] => [n, s]) };
}
