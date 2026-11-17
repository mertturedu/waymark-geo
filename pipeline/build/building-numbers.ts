import { DEFAULT_RADIUS, increasesAlong, radiusFor } from '../../src/core/address/sequence';
import { metres, MIN_AREA_M2, type Cand } from './building-link';
import type { Row } from './building-pack-v2';

export const SOURCE_OSM = 1;
export const SOURCE_DIRECTORY = 2;

export const ANCHOR_REACH_M = 25;
export const DIRECTORY_REACH_M = 30;
export const MAX_GAP = 40;
export const MIN_SPACING_M = 1;
export const MAX_SPACING_M = 80;
export const DEFAULT_SPACING_M = 14;
export const CONFLICT_M = 60;

export type Door = { lon: number; lat: number; num: number; text: string; src: 1 | 2; street?: number; streetKey?: string };

export type Predicted = { value: number; radiusM: number; confidence: number; extrapolated: boolean };
export type BuildingNumber = { known: string | null; source: number | null; predicted: Predicted | null };
export type RangeRow = { chain: number; component: number; side: number; parity: number; min: number; max: number; predictedMin: number | null; predictedMax: number | null; anchors: number; quality: number };
export type NumberStats = { doors: number; placed: number; conflicts: number; known: number; predicted: number; tracks: number; anchoredTracks: number };

type Anchor = { s: number; num: number; weight: number; src: 1 | 2; building: number };
type Track = { chain: number; component: number; side: 1 | -1; members: { i: number; s: number }[]; anchors: Anchor[] };

const CELL = 0.0006;
const parityOf = (n: number): number => Math.abs(n) % 2;

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

function inRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as [number, number];
    const b = ring[j] as [number, number];
    if (a[1] > lat !== b[1] > lat && lon < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function candidateFor(row: Row, door: Door, chainKeys: Map<number, string>): Cand | null {
  const link = row.link;
  if (!link) return null;
  for (const c of link.candidates) {
    if (door.street !== undefined ? c.chain === door.street : chainKeys.get(c.chain) === door.streetKey) return c;
  }
  return null;
}

export function placeDoors(rows: Row[], doors: Door[], chainKeys: Map<number, string>): { anchors: Map<number, { cand: Cand; door: Door }[]>; conflicts: number } {
  const grid = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (!r.link || r.trace.area < MIN_AREA_M2) return;
    const key = `${Math.floor(r.trace.lon / CELL)}:${Math.floor(r.trace.lat / CELL)}`;
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  });
  const out = new Map<number, { cand: Cand; door: Door }[]>();
  const seen = new Map<string, Door>();
  let conflicts = 0;
  for (const door of [...doors].sort((a, b) => a.src - b.src)) {
    const reach = door.src === SOURCE_OSM ? ANCHOR_REACH_M : DIRECTORY_REACH_M;
    const cx = Math.floor(door.lon / CELL);
    const cy = Math.floor(door.lat / CELL);
    let best: { i: number; cand: Cand; d: number } | null = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
        const row = rows[i] as Row;
        const cand = candidateFor(row, door, chainKeys);
        if (!cand) continue;
        const inside = !!row.trace.ring && row.trace.ring.length > 2 && inRing(door.lon, door.lat, row.trace.ring);
        const d = inside ? 0 : metres([door.lon, door.lat], [row.trace.lon, row.trace.lat]);
        if (d <= reach && (!best || d < best.d)) best = { i, cand, d };
      }
    }
    if (!best) continue;
    const identity = `${best.cand.chain}:${door.num}:${door.text}`;
    const earlier = seen.get(identity);
    if (earlier) {
      if (metres([earlier.lon, earlier.lat], [door.lon, door.lat]) > CONFLICT_M) conflicts += 1;
      continue;
    }
    seen.set(identity, door);
    const list = out.get(best.i);
    if (list) list.push({ cand: best.cand, door });
    else out.set(best.i, [{ cand: best.cand, door }]);
  }
  return { anchors: out, conflicts };
}

function fitTrack(track: Track): { parity: number; sign: 1 | -1; spacing: number } | null {
  if (track.anchors.some((a) => a.src === SOURCE_OSM)) track.anchors = track.anchors.filter((a) => a.src === SOURCE_OSM);
  if (track.anchors.length === 0) return null;
  const weight = [0, 0];
  for (const a of track.anchors) weight[parityOf(a.num)] = (weight[parityOf(a.num)] as number) + a.weight;
  const parity = (weight[1] as number) >= (weight[0] as number) ? 1 : 0;
  const kept = track.anchors.filter((a) => parityOf(a.num) === parity).sort((a, b) => a.s - b.s);
  track.anchors = kept;
  let up = 0;
  let down = 0;
  const gaps: number[] = [];
  for (let i = 1; i < kept.length; i++) {
    const a = kept[i - 1] as Anchor;
    const b = kept[i] as Anchor;
    if (a.num === b.num || b.s - a.s < MIN_SPACING_M) continue;
    if (b.num > a.num) up += 1;
    else down += 1;
    const gap = (b.s - a.s) / (Math.abs(b.num - a.num) / 2);
    if (gap >= MIN_SPACING_M && gap <= MAX_SPACING_M) gaps.push(gap);
  }
  const fallback = increasesAlong(parity, track.side === 1 ? 'left' : 'right');
  const sign: 1 | -1 = up + down >= 2 && Math.max(up, down) / (up + down) >= 0.8 ? (up >= down ? 1 : -1) : fallback;
  return { parity, sign, spacing: median(gaps) ?? DEFAULT_SPACING_M };
}

const toParity = (value: number, parity: number): number => {
  const n = Math.round((value - parity) / 2) * 2 + parity;
  return n < 1 ? (parity === 1 ? 1 : 2) : n;
};

export function predictNumbers(rows: Row[], placed: Map<number, { cand: Cand; door: Door }[]>): { numbers: (BuildingNumber | null)[]; ranges: RangeRow[]; stats: Pick<NumberStats, 'known' | 'predicted' | 'tracks' | 'anchoredTracks'> } {
  const tracks = new Map<string, Track>();
  const track = (chain: number, component: number, side: 1 | -1): Track => {
    const key = `${chain}:${component}:${side}`;
    let t = tracks.get(key);
    if (!t) {
      t = { chain, component, side, members: [], anchors: [] };
      tracks.set(key, t);
    }
    return t;
  };
  const numbers: (BuildingNumber | null)[] = rows.map(() => null);
  rows.forEach((r, i) => {
    if (!r.link || r.trace.area < MIN_AREA_M2) return;
    track(r.link.chain, r.link.component, r.link.side).members.push({ i, s: r.link.s });
  });
  for (const [i, list] of placed) {
    for (const { cand, door } of list) {
      track(cand.chain, cand.component, cand.side).anchors.push({ s: cand.s, num: door.num, weight: door.src === SOURCE_OSM ? 1 : 0.5, src: door.src, building: i });
    }
    const best = [...list].sort((a, b) => a.door.src - b.door.src)[0];
    if (best) numbers[i] = { known: best.door.text, source: best.door.src, predicted: null };
  }
  const ranges: RangeRow[] = [];
  let anchoredTracks = 0;
  let predictedCount = 0;
  type Fit = NonNullable<ReturnType<typeof fitTrack>>;
  const fits = new Map<string, { fit: Fit; track: Track }>();
  const valueAt = (t: Track, fit: Fit, s: number): { value: number; extrapolated: boolean; nearest: Anchor } => {
    const anchors = t.anchors;
    const before = [...anchors].filter((a) => a.s <= s).pop();
    const after = anchors.find((a) => a.s >= s);
    if (before && after && before.num !== after.num && (after.num - before.num) * fit.sign > 0 && after.s > before.s) {
      return { value: before.num + ((s - before.s) / (after.s - before.s)) * (after.num - before.num), extrapolated: false, nearest: s - before.s <= after.s - s ? before : after };
    }
    const nearest = anchors.reduce((a, b) => (Math.abs(a.s - s) <= Math.abs(b.s - s) ? a : b));
    return { value: nearest.num + fit.sign * ((s - nearest.s) / fit.spacing) * 2, extrapolated: true, nearest };
  };
  const confidenceOf = (extrapolated: boolean, delta: number, anchors: number, factor: number): number => Math.round(100 * Math.max(0.1, ((extrapolated ? 0.55 : 0.85) - Math.min(0.4, delta * 0.01) - (anchors === 1 ? 0.1 : 0)) * factor));
  for (const t of tracks.values()) {
    const fit = fitTrack(t);
    if (!fit || t.anchors.length === 0) continue;
    anchoredTracks += 1;
    fits.set(`${t.chain}:${t.component}:${t.side}`, { fit, track: t });
    const anchors = t.anchors;
    const predicted: number[] = [];
    for (const m of t.members) {
      if (numbers[m.i]?.known) continue;
      const { value, extrapolated, nearest } = valueAt(t, fit, m.s);
      const snapped = toParity(value, fit.parity);
      const delta = Math.abs(snapped - nearest.num);
      if (delta > MAX_GAP) continue;
      numbers[m.i] = { known: null, source: null, predicted: { value: snapped, radiusM: Math.round(radiusFor(DEFAULT_RADIUS, delta, anchors.length)), confidence: confidenceOf(extrapolated, delta, anchors.length, 1), extrapolated } };
      predicted.push(snapped);
      predictedCount += 1;
    }
    const nums = anchors.map((a) => a.num);
    ranges.push({
      chain: t.chain,
      component: t.component,
      side: t.side,
      parity: fit.parity,
      min: Math.min(...nums),
      max: Math.max(...nums),
      predictedMin: predicted.length > 0 ? Math.min(...predicted) : null,
      predictedMax: predicted.length > 0 ? Math.max(...predicted) : null,
      anchors: anchors.length,
      quality: anchors.length >= 3 ? 3 : anchors.length === 2 ? 2 : 1,
    });
  }
  for (const t of tracks.values()) {
    if (fits.has(`${t.chain}:${t.component}:${t.side}`)) continue;
    const mate = fits.get(`${t.chain}:${t.component}:${-t.side}`);
    if (!mate) continue;
    const parity = 1 - mate.fit.parity;
    for (const m of t.members) {
      const { value, nearest } = valueAt(mate.track, mate.fit, m.s);
      const snapped = toParity(value, parity);
      const delta = Math.abs(snapped - nearest.num);
      if (delta > MAX_GAP) continue;
      numbers[m.i] = { known: null, source: null, predicted: { value: snapped, radiusM: Math.round(radiusFor(DEFAULT_RADIUS, delta + 2, 1)), confidence: confidenceOf(true, delta, 1, 0.6), extrapolated: true } };
      predictedCount += 1;
    }
  }
  const known = numbers.filter((n) => n?.known).length;
  return { numbers, ranges, stats: { known, predicted: predictedCount, tracks: tracks.size, anchoredTracks } };
}
