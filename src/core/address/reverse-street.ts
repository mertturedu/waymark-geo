import type { LngLat } from '../geo/cells';
import { distanceM, projectOnLine } from '../geo/distance';
import type { AroundDoor } from './types';

export type StreetDoor = { number: number; point: LngLat; id?: number };
export type StreetNumber = { number: number; low: number; high: number; parity: 0 | 1; side: 'left' | 'right'; anchors: number; slope: 1 | -1 };

export const DOOR_REACH_M = 70;
const MIN_HALF_RANGE = 2;
const NUMBER_SLACK = 0.075;
const M_PER_DEGREE = 111_320;

export function sideOfLine(point: LngLat, line: LngLat[]): 'left' | 'right' {
  const k = Math.cos((point[1] * Math.PI) / 180) * M_PER_DEGREE;
  let best = Infinity;
  let cross = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1] as LngLat;
    const b = line[i] as LngLat;
    const dx = (b[0] - a[0]) * k;
    const dy = (b[1] - a[1]) * M_PER_DEGREE;
    const px = (point[0] - a[0]) * k;
    const py = (point[1] - a[1]) * M_PER_DEGREE;
    const squared = dx * dx + dy * dy;
    const t = squared === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / squared));
    const away = Math.hypot(px - dx * t, py - dy * t);
    if (away < best) {
      best = away;
      cross = dx * py - dy * px;
    }
  }
  return cross >= 0 ? 'left' : 'right';
}

type Placed = { number: number; along: number; side: 'left' | 'right'; away: number };

export function nearestLine(point: LngLat, lines: LngLat[][]): { line: LngLat[]; distanceM: number } | null {
  let best: { line: LngLat[]; distanceM: number } | null = null;
  for (const line of lines) {
    if (line.length < 2) continue;
    const d = projectOnLine(point, line).distanceM;
    if (best === null || d < best.distanceM) best = { line, distanceM: d };
  }
  return best;
}

const parityOf = (n: number): 0 | 1 => (Math.abs(n) % 2) as 0 | 1;

function majority(list: Placed[]): 0 | 1 | null {
  let even = 0;
  let odd = 0;
  for (const p of list) {
    if (parityOf(p.number) === 0) even += 1 / (1 + p.away / 20);
    else odd += 1 / (1 + p.away / 20);
  }
  return even === odd ? null : even > odd ? 0 : 1;
}

export function estimateOnStreet(point: LngLat, line: LngLat[], doors: StreetDoor[]): StreetNumber | null {
  if (line.length < 2) return null;
  const here = projectOnLine(point, line);
  const side = sideOfLine(point, line);
  const placed: Placed[] = [];
  for (const d of doors) {
    const p = projectOnLine(d.point, line);
    if (p.distanceM > DOOR_REACH_M) continue;
    placed.push({ number: d.number, along: p.alongM, side: sideOfLine(d.point, line), away: p.distanceM });
  }
  if (placed.length === 0) return null;
  const own = placed.filter((p) => p.side === side);
  let parity = majority(own);
  let opposite = false;
  if (parity === null) {
    const other = majority(placed.filter((p) => p.side !== side));
    if (other === null) return null;
    parity = (1 - other) as 0 | 1;
    opposite = true;
  }
  const pool = (opposite ? placed : own).filter((p) => opposite || parityOf(p.number) === parity);
  if (pool.length === 0) return null;
  const sorted = [...pool].sort((a, b) => a.along - b.along || a.number - b.number);
  let slope: 1 | -1 = 1;
  if (sorted.length >= 2) {
    const first = sorted[0] as Placed;
    const last = sorted[sorted.length - 1] as Placed;
    slope = last.number >= first.number ? 1 : -1;
  }
  const lower = [...sorted].reverse().find((p) => p.along <= here.alongM);
  const upper = sorted.find((p) => p.along >= here.alongM);
  let value: number;
  if (lower && upper && upper.along !== lower.along && upper.number !== lower.number) {
    value = lower.number + ((here.alongM - lower.along) / (upper.along - lower.along)) * (upper.number - lower.number);
  } else {
    const anchor = lower && upper ? (Math.abs(here.alongM - lower.along) <= Math.abs(upper.along - here.alongM) ? lower : upper) : (lower ?? upper) as Placed;
    const pairs: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1] as Placed;
      const b = sorted[i] as Placed;
      const steps = Math.abs(b.number - a.number) / 2;
      if (steps > 0 && b.along > a.along) pairs.push((b.along - a.along) / steps);
    }
    pairs.sort((x, y) => x - y);
    const spacing = pairs.length > 0 ? (pairs[Math.floor(pairs.length / 2)] as number) : 14;
    value = anchor.number + (slope * 2 * (here.alongM - anchor.along)) / Math.max(4, spacing);
  }
  const floor = parity === 0 ? 2 : 1;
  const number = Math.max(floor, Math.round((value - parity) / 2) * 2 + parity);
  const nearest = Math.min(...pool.map((p) => Math.abs(p.number - number)));
  const half = Math.max(MIN_HALF_RANGE, 2 * Math.ceil(NUMBER_SLACK * nearest));
  return { number, low: Math.max(floor, number - half), high: number + half, parity, side, anchors: pool.length, slope };
}

const PRIMARY_WEIGHT = 2.5;
const SECOND_WEIGHT = 0.6;
const THIRD_WEIGHT = 0.3;
const VOTE_REACH_M = 40;

export function voteStreet(point: LngLat, rows: { streetId: number | null; point: LngLat }[], preferred: (number | null)[]): number | null {
  const candidates = preferred.filter((id): id is number => id !== null);
  const pool = candidates.length > 0 ? new Set(candidates) : null;
  const score = new Map<number, number>();
  for (const r of rows) {
    if (r.streetId === null || (pool !== null && !pool.has(r.streetId))) continue;
    const gap = distanceM(point, r.point);
    if (gap > (pool === null ? DOOR_REACH_M : VOTE_REACH_M)) continue;
    score.set(r.streetId, (score.get(r.streetId) ?? 0) + 1 / (1 + gap / 15));
  }
  [PRIMARY_WEIGHT, SECOND_WEIGHT, THIRD_WEIGHT].forEach((weight, i) => {
    const id = preferred[i];
    if (id !== null && id !== undefined) score.set(id, (score.get(id) ?? 0) + weight);
  });
  let best: number | null = null;
  let bestScore = 0;
  for (const [id, value] of score) {
    if (value > bestScore || (value === bestScore && best !== null && id < best)) {
      best = id;
      bestScore = value;
    }
  }
  return best;
}

const AROUND_REACH_M = 60;

export function aroundOnLine(building: { id: number; center: LngLat }, neighbours: { id: number; center: LngLat }[], line: LngLat[], estimate: StreetNumber | null): AroundDoor[] {
  const here = projectOnLine(building.center, line);
  const side = sideOfLine(building.center, line);
  const same = neighbours
    .filter((n) => n.id !== building.id)
    .map((n) => ({ n, p: projectOnLine(n.center, line) }))
    .filter((x) => x.p.distanceM <= AROUND_REACH_M && sideOfLine(x.n.center, line) === side);
  const before = same.filter((x) => x.p.alongM < here.alongM).sort((a, b) => b.p.alongM - a.p.alongM || a.n.id - b.n.id);
  const after = same.filter((x) => x.p.alongM >= here.alongM).sort((a, b) => a.p.alongM - b.p.alongM || a.n.id - b.n.id);
  const out: AroundDoor[] = [];
  const add = (offset: -2 | -1 | 1 | 2, found: { n: { center: LngLat } } | undefined): void => {
    if (!found) return;
    const number = estimate ? estimate.number + estimate.slope * 2 * offset : null;
    out.push({ offset, coordinate: found.n.center, number: number !== null && number >= 1 ? String(number) : null });
  };
  add(-2, before[1]);
  add(-1, before[0]);
  add(1, after[0]);
  add(2, after[1]);
  return out;
}
