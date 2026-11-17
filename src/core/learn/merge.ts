import type { LngLat } from '../geo/cells';
import type { Confirmation, ConfirmSource } from './types';

export type Merged = { coordinate: LngLat; trusted: boolean; count: number; used: number; outliers: number[]; spreadM: number };

export const OUTLIER_M = 50;
export const TRUST_SPREAD_M = 25;
export const BASE_WEIGHT: Record<ConfirmSource, number> = { pin: 4, manual: 3, delivery: 1 };

const DEFAULT_ACCURACY_M: Record<ConfirmSource, number> = { pin: 5, manual: 5, delivery: 15 };
const MIN_ACCURACY_M = 5;
const MAX_ACCURACY_M = 10_000;
const MEDIAN_ROUNDS = 30;
const MIN_STEP_M = 1e-6;
const M_PER_DEGREE = 111_195;
const RAD = Math.PI / 180;

type Item = { index: number; x: number; y: number; w: number; source: ConfirmSource; at: number; lng: number; lat: number };

function weightOf(c: Confirmation): number {
  const accuracy = Number.isFinite(c.accuracyM) && (c.accuracyM as number) > 0 ? (c.accuracyM as number) : DEFAULT_ACCURACY_M[c.source];
  return BASE_WEIGHT[c.source] / Math.min(Math.max(accuracy, MIN_ACCURACY_M), MAX_ACCURACY_M) ** 2;
}

function mean(items: Item[]): { x: number; y: number } {
  let w = 0;
  let x = 0;
  let y = 0;
  for (const i of items) {
    w += i.w;
    x += i.w * i.x;
    y += i.w * i.y;
  }
  return { x: x / w, y: y / w };
}

function median(items: Item[]): { x: number; y: number } {
  let c = mean(items);
  for (let round = 0; round < MEDIAN_ROUNDS; round++) {
    let w = 0;
    let x = 0;
    let y = 0;
    for (const i of items) {
      const k = i.w / Math.max(Math.hypot(i.x - c.x, i.y - c.y), MIN_STEP_M);
      w += k;
      x += k * i.x;
      y += k * i.y;
    }
    c = { x: x / w, y: y / w };
  }
  return c;
}

function beats(a: Item, b: Item): boolean {
  return a.w !== b.w ? a.w > b.w : a.at !== b.at ? a.at > b.at : a.lng !== b.lng ? a.lng > b.lng : a.lat > b.lat;
}

function heaviest(items: Item[]): Item {
  return items.reduce((best, i) => (beats(i, best) ? i : best));
}

export function mergeConfirmations(list: Confirmation[]): Merged | null {
  if (list.length === 0) return null;
  const lat0 = list[0]?.lat as number;
  const lng0 = list[0]?.lng as number;
  const kx = M_PER_DEGREE * Math.cos(lat0 * RAD);
  const items: Item[] = list.map((c, index) => ({ index, x: (c.lng - lng0) * kx, y: (c.lat - lat0) * M_PER_DEGREE, w: weightOf(c), source: c.source, at: c.at, lng: c.lng, lat: c.lat }));
  let inliers = items;
  if (items.length === 2) {
    const [a, b] = items as [Item, Item];
    if (Math.hypot(a.x - b.x, a.y - b.y) > OUTLIER_M) inliers = [heaviest(items)];
  } else if (items.length > 2) {
    const centre = median(items);
    const near = items.filter((i) => Math.hypot(i.x - centre.x, i.y - centre.y) <= OUTLIER_M);
    inliers = near.length > 0 ? near : [heaviest(items)];
  }
  const centre = mean(inliers);
  const spreadM = inliers.reduce((far, i) => Math.max(far, Math.hypot(i.x - centre.x, i.y - centre.y)), 0);
  const used = new Set(inliers.map((i) => i.index));
  const outliers = items.filter((i) => !used.has(i.index)).map((i) => i.index).sort((a, b) => a - b);
  const sure = inliers.some((i) => i.source !== 'delivery') || (inliers.length >= 2 && spreadM < TRUST_SPREAD_M);
  const only = inliers.length === 1 ? (inliers[0] as Item) : null;
  const coordinate: LngLat = only ? [only.lng, only.lat] : [lng0 + centre.x / kx, lat0 + centre.y / M_PER_DEGREE];
  return { coordinate, trusted: sure, count: list.length, used: inliers.length, outliers, spreadM: only ? 0 : spreadM };
}
