import type { LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import { pointInRing, type BuildingInfo } from './buildings2';

export type Anchor = { number: number; point: LngLat; weight: number };

export type SequenceResult = {
  building: BuildingInfo;
  radiusM: number;
  anchors: number;
  notes: string[];
};

export type SequenceOptions = { radius?: RadiusModel };
export type RadiusModel = { bins: number[]; one: number[]; many: number[] };

export const DEFAULT_RADIUS: RadiusModel = {
  bins: [2, 4, 8, 16, 32, Number.POSITIVE_INFINITY],
  one: [52, 64, 101, 162, 269, 968],
  many: [91, 113, 181, 250, 540, 1000],
};

export function radiusFor(model: RadiusModel, delta: number, anchors: number): number {
  const at = model.bins.findIndex((limit) => delta <= limit);
  return (anchors <= 1 ? model.one : model.many)[at < 0 ? model.bins.length - 1 : at] as number;
}

const ANCHOR_REACH_M = 25;
const DEFAULT_SPACING_M = 14;
const MIN_SPACING_M = 1;
const MAX_SPACING_M = 80;
const NEIGHBOURHOOD = 6;
const OUT_OF_RANGE_SPACINGS = 1.5;
const OUTLIER_FACTOR = 3;
const MIN_FOR_OUTLIERS = 4;

type Placed = { anchor: Anchor; building: BuildingInfo };

const keyOf = (part: number, side: string): string => `${part}:${side}`;
const parityOf = (n: number): number => Math.abs(n) % 2;
const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

export const increasesAlong = (parity: number, side: 'left' | 'right'): 1 | -1 => ((parity === 1) === (side === 'left') ? 1 : -1);

function tracksOf(buildings: BuildingInfo[]): Map<string, BuildingInfo[]> {
  const out = new Map<string, BuildingInfo[]>();
  for (const b of buildings) {
    if (b.part === null || b.side === null || b.along === null || b.sequence === null) continue;
    const key = keyOf(b.part, b.side);
    const list = out.get(key);
    if (list) list.push(b);
    else out.set(key, [b]);
  }
  for (const list of out.values()) list.sort((a, b) => (a.along as number) - (b.along as number) || a.id - b.id);
  return out;
}

function localSpacing(list: BuildingInfo[], at: number): number {
  const gaps: number[] = [];
  for (let i = Math.max(1, at - NEIGHBOURHOOD); i <= Math.min(list.length - 1, at + NEIGHBOURHOOD); i++) {
    const gap = (list[i]?.along as number) - (list[i - 1]?.along as number);
    if (gap >= MIN_SPACING_M && gap <= MAX_SPACING_M) gaps.push(gap);
  }
  return median(gaps) ?? DEFAULT_SPACING_M;
}

function nearestAlong(list: BuildingInfo[], along: number): { building: BuildingInfo; index: number } {
  let low = 0;
  let high = list.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((list[mid]?.along as number) < along) low = mid + 1;
    else high = mid;
  }
  const before = Math.max(0, low - 1);
  const pick = Math.abs((list[low]?.along as number) - along) <= Math.abs((list[before]?.along as number) - along) ? low : before;
  return { building: list[pick] as BuildingInfo, index: pick };
}

function place(anchors: Anchor[], buildings: BuildingInfo[]): Placed[] {
  const out: Placed[] = [];
  for (const anchor of anchors) {
    let inside: BuildingInfo | null = null;
    let best: BuildingInfo | null = null;
    let bestD = ANCHOR_REACH_M;
    for (const b of buildings) {
      if (b.part === null || b.side === null || b.along === null) continue;
      if (b.ring.length > 2 && pointInRing(anchor.point, b.ring) && (inside === null || b.areaM2 < inside.areaM2)) inside = b;
      const d = distanceM(b.center, anchor.point);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    const chosen = inside ?? best;
    if (chosen) out.push({ anchor, building: chosen });
  }
  return out;
}

function pairSpacing(placed: Placed[]): number | null {
  const sorted = [...placed].sort((a, b) => a.anchor.number - b.anchor.number);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as Placed;
    const b = sorted[i] as Placed;
    if (a.anchor.number === b.anchor.number) continue;
    const gap = Math.abs(((b.building.along as number) - (a.building.along as number)) / ((b.anchor.number - a.anchor.number) / 2));
    if (gap >= MIN_SPACING_M && gap <= MAX_SPACING_M) gaps.push(gap);
  }
  return median(gaps);
}

function withoutOutliers(placed: Placed[], side: 'left' | 'right', fallback: number): Placed[] {
  if (placed.length < MIN_FOR_OUTLIERS) return placed;
  const spacing = pairSpacing(placed) ?? fallback;
  const sign = increasesAlong(parityOf(placed[0]?.anchor.number ?? 0), side);
  const residuals = placed.map((p) => (p.building.along as number) - sign * (p.anchor.number / 2) * spacing);
  const centre = median(residuals) as number;
  const spread = (median(residuals.map((r) => Math.abs(r - centre))) as number) || spacing;
  return placed.filter((_, i) => Math.abs((residuals[i] as number) - centre) <= OUTLIER_FACTOR * Math.max(spread, spacing));
}

function dominantTrack(placed: Placed[]): { part: number; side: 'left' | 'right' } {
  const counts = new Map<string, { part: number; side: 'left' | 'right'; n: number }>();
  for (const p of placed) {
    const key = keyOf(p.building.part as number, p.building.side as string);
    const entry = counts.get(key) ?? { part: p.building.part as number, side: p.building.side as 'left' | 'right', n: 0 };
    entry.n += p.anchor.weight;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.part - b.part)[0] as { part: number; side: 'left' | 'right' };
}

function weightedMedian(items: { value: number; weight: number }[]): number {
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const half = sorted.reduce((sum, item) => sum + item.weight, 0) / 2;
  let run = 0;
  for (const item of sorted) {
    run += item.weight;
    if (run >= half) return item.value;
  }
  return (sorted[sorted.length - 1] as { value: number }).value;
}

export function bracketed(number: number, anchors: Anchor[]): boolean {
  const same = anchors.filter((a) => parityOf(a.number) === parityOf(number));
  return same.some((a) => a.number < number) && same.some((a) => a.number > number);
}

export function predictFromBuildings(input: { number: number; anchors: Anchor[]; buildings: BuildingInfo[] }, options: SequenceOptions = {}): SequenceResult | null {
  const tracks = tracksOf(input.buildings);
  if (tracks.size === 0) return null;
  const placed = place(input.anchors, input.buildings).filter((p) => p.building.part !== null && p.building.side !== null);
  if (placed.length === 0) return null;
  const wantedParity = parityOf(input.number);
  const sameParity = placed.filter((p) => parityOf(p.anchor.number) === wantedParity);
  const dominant = dominantTrack(sameParity.length > 0 ? sameParity : placed);
  const part = dominant.part;
  const inPart = placed.filter((p) => p.building.part === part);
  const sameTrack = inPart.filter((p) => parityOf(p.anchor.number) === wantedParity && p.building.side === dominant.side);
  const side: 'left' | 'right' = sameParity.length > 0 ? dominant.side : dominant.side === 'left' ? 'right' : 'left';
  const target = tracks.get(keyOf(part, side));
  const homeList = tracks.get(keyOf(part, dominant.side));
  if (!target || !homeList) return null;
  const keptTrack = withoutOutliers(sameParity.length > 0 ? sameTrack : inPart.filter((p) => p.building.side === dominant.side), dominant.side, DEFAULT_SPACING_M);
  const kept = keptTrack;
  const reference = kept.reduce((a, b) => (Math.abs(a.anchor.number - input.number) / a.anchor.weight <= Math.abs(b.anchor.number - input.number) / b.anchor.weight ? a : b));
  const index = homeList.findIndex((b) => b.id === reference.building.id);
  let spacing = localSpacing(homeList, Math.max(0, index));
  const fitted = pairSpacing(kept);
  if (fitted !== null) spacing = fitted;
  const sign = increasesAlong(wantedParity, side);
  const sorted = [...kept].sort((a, b) => a.anchor.number - b.anchor.number);
  const lower = sorted.filter((p) => p.anchor.number <= input.number && parityOf(p.anchor.number) === wantedParity).pop();
  const upper = sorted.find((p) => p.anchor.number >= input.number && parityOf(p.anchor.number) === wantedParity);
  let along: number;
  if (lower && upper && lower.anchor.number !== upper.anchor.number) {
    const t = (input.number - lower.anchor.number) / (upper.anchor.number - lower.anchor.number);
    along = (lower.building.along as number) + t * ((upper.building.along as number) - (lower.building.along as number));
  } else {
    const estimates = kept.map((p) => ({ value: (p.building.along as number) + sign * ((input.number - p.anchor.number) / 2) * spacing, weight: p.anchor.weight / (1 + Math.abs(input.number - p.anchor.number)) }));
    along = weightedMedian(estimates);
  }
  const found = nearestAlong(target, along);
  const notes: string[] = [];
  const first = target[0]?.along as number;
  const last = target[target.length - 1]?.along as number;
  if (along < first - OUT_OF_RANGE_SPACINGS * spacing || along > last + OUT_OF_RANGE_SPACINGS * spacing) notes.push('number_out_of_range');
  const nearest = Math.min(...kept.map((p) => Math.abs(p.anchor.number - input.number)));
  const radiusM = radiusFor(options.radius ?? DEFAULT_RADIUS, nearest, kept.length);
  return { building: found.building, radiusM: Math.round(radiusM * 10) / 10, anchors: kept.length, notes };
}
