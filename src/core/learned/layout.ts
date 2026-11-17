import { estimateFloor, type FloorInfo } from '../address/floor';
import type { BuildingLayout, FloorRange } from './types';

export type FloorDoor = { floor: number; door: number };

export const MIN_LAYOUT_PAIRS = 3;
const MAX_PER_FLOOR = 8;
export const MIN_FIT = 0.6;
const SURE_FIT = 0.9;
const MAX_FLOOR = 80;
const MAX_DOOR = 2000;

export const layoutKey = (doorKey: string, block: string | null): string => (block ? `${doorKey}#${block}` : doorKey);

const fits = (pairs: FloorDoor[], per: number, basement: number): number => pairs.reduce((n, p) => n + (estimateFloor(p.door, per, basement).value === p.floor ? 1 : 0), 0);

export function fitLayout(raw: readonly FloorDoor[]): BuildingLayout | null {
  const seen = new Set<string>();
  const pairs = raw.filter((p) => Number.isInteger(p.floor) && Number.isInteger(p.door) && p.floor >= -MAX_FLOOR && p.floor <= MAX_FLOOR && p.door > 0 && p.door <= MAX_DOOR && !seen.has(`${p.floor}/${p.door}`) && seen.add(`${p.floor}/${p.door}`));
  if (pairs.length < MIN_LAYOUT_PAIRS) return null;
  const floors = pairs.map((p) => p.floor);
  const lowest = Math.min(...floors);
  const basement = lowest < 0 ? -lowest : 0;
  let per = 0;
  let best = -1;
  for (let candidate = 1; candidate <= MAX_PER_FLOOR * 2; candidate++) {
    const hit = fits(pairs, candidate, basement);
    if (hit > best) {
      best = hit;
      per = candidate;
    }
  }
  const fit = best / pairs.length;
  const byFloor = new Map<number, number[]>();
  for (const p of pairs) byFloor.set(p.floor, [...(byFloor.get(p.floor) ?? []), p.door]);
  const ranges: FloorRange[] = [...byFloor].sort((a, b) => a[0] - b[0]).map(([floor, doors]) => [floor, Math.min(...doors), Math.max(...doors)]);
  return { perFloor: fit >= MIN_FIT ? per : 0, basement, floors: Math.max(...floors), fit: Math.round(fit * 100) / 100, samples: pairs.length, ranges };
}

export function floorFromLayout(layout: BuildingLayout, door: number): FloorInfo | null {
  const inside = layout.ranges.filter(([, low, high]) => door >= low && door <= high);
  if (inside.length === 1) {
    const value = (inside[0] as FloorRange)[0];
    return { value, low: value, high: value, source: 'learned' };
  }
  if (layout.perFloor > 0 && layout.fit >= MIN_FIT) {
    const model = estimateFloor(door, layout.perFloor, layout.basement);
    return layout.fit >= SURE_FIT ? { value: model.value, low: model.value, high: model.value, source: 'learned' } : { ...model, source: 'learned' };
  }
  return null;
}
