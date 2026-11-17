import type { LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import type { StreetWay } from './types';

export function wayPoint(way: StreetWay, houseNumber: number): LngLat | null {
  const { line, doors } = way;
  if (line.length < 2 || doors.length < 4) return null;
  const along = [0];
  for (let i = 1; i < line.length; i++) along.push(along[i - 1]! + distanceM(line[i - 1]!, line[i]!));
  const total = along[along.length - 1]!;
  if (total <= 0) return null;
  const sameSide = doors.filter(([n]) => n % 2 === houseNumber % 2);
  const pool = (sameSide.length >= 2 ? sameSide : doors).slice().sort((a, b) => a[0] - b[0]);
  const below = [...pool].reverse().find(([n]) => n <= houseNumber);
  const above = pool.find(([n]) => n >= houseNumber);
  const edge = below ?? above;
  if (!edge) return null;
  const s = below && above && above[0] !== below[0] ? below[1] + ((above[1] - below[1]) * (houseNumber - below[0])) / (above[0] - below[0]) : edge[1];
  const at = Math.max(0, Math.min(total, s));
  for (let i = 1; i < line.length; i++) {
    if (at <= along[i]!) {
      const span = along[i]! - along[i - 1]!;
      const t = span > 0 ? (at - along[i - 1]!) / span : 0;
      return [line[i - 1]![0] + (line[i]![0] - line[i - 1]![0]) * t, line[i - 1]![1] + (line[i]![1] - line[i - 1]![1]) * t];
    }
  }
  return line[line.length - 1]!;
}
