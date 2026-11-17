import type { LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import type { BuildingInfo } from './buildings2';

export type Relation = 'opposite' | 'beside' | 'behind' | 'corner';
export type RelationAsk = { relation: Relation; query: string };
export type Target = { coordinate: LngLat; radiusM: number; building: number | null };

const WORDS: Record<Relation, string[]> = {
  opposite: ['karsisi', 'karsisinda', 'karsisindaki', 'karsi', 'opposite', 'gegenuber'],
  beside: ['yani', 'yaninda', 'yanindaki', 'bitisigi', 'bitisiginde', 'beside', 'neben'],
  behind: ['arkasi', 'arkasinda', 'arkasindaki', 'behind', 'hinter'],
  corner: ['kosesi', 'kosesinde', 'kosesindeki', 'corner'],
};

const LOOKUP = new Map<string, Relation>((Object.entries(WORDS) as [Relation, string[]][]).flatMap(([relation, words]) => words.map((w): [string, Relation] => [w, relation])));

export const RELATION_LABEL: Record<'tr' | 'en' | 'de' | 'ar' | 'ru' | 'el', Record<Relation, string>> = {
  tr: { opposite: 'karşısı', beside: 'yanı', behind: 'arkası', corner: 'köşesi' },
  en: { opposite: 'opposite', beside: 'next to', behind: 'behind', corner: 'corner' },
  de: { opposite: 'gegenüber', beside: 'neben', behind: 'hinter', corner: 'Ecke' },
  ar: { opposite: 'مقابل', beside: 'بجانب', behind: 'خلف', corner: 'زاوية' },
  ru: { opposite: 'напротив', beside: 'рядом с', behind: 'за', corner: 'угол' },
  el: { opposite: 'απέναντι', beside: 'δίπλα', behind: 'πίσω', corner: 'γωνία' },
};

export const OPPOSITE_REACH_M = 70;
export const BESIDE_REACH_M = 80;
export const CORNER_REACH_M = 80;
export const BEHIND_STEP_M = 45;
export const LANDMARK_LINK_M = 40;
const M_PER_DEGREE = 111_320;

export function relationOf(key: string): RelationAsk | null {
  const words = key.split(' ').filter((w) => w !== '');
  const at = words.findIndex((w, i) => i > 0 && i < words.length && LOOKUP.has(w));
  if (at < 0) return null;
  const relation = LOOKUP.get(words[at] as string) as Relation;
  const rest = words.filter((_, i) => i !== at && !(relation === 'beside' && i === at - 1 && words[at - 1] === 'next'));
  return rest.length === 0 ? null : { relation, query: rest.join(' ') };
}

const trackOf = (base: BuildingInfo, list: BuildingInfo[], sameSide: boolean): BuildingInfo[] =>
  list.filter((b) => b.id !== base.id && b.part === base.part && b.side !== null && b.along !== null && (sameSide ? b.side === base.side : b.side !== base.side)).sort((a, b) => (a.along as number) - (b.along as number) || a.id - b.id);

export function oppositeOf(base: BuildingInfo, street: BuildingInfo[]): Target | null {
  if (base.along === null) return null;
  let best: BuildingInfo | null = null;
  let gap = OPPOSITE_REACH_M;
  for (const b of trackOf(base, street, false)) {
    const d = Math.abs((b.along as number) - base.along);
    if (d < gap) {
      gap = d;
      best = b;
    }
  }
  return best ? { coordinate: best.center, radiusM: 35, building: best.id } : null;
}

export function besideOf(base: BuildingInfo, street: BuildingInfo[]): Target[] {
  if (base.along === null) return [];
  const same = trackOf(base, street, true);
  const before = [...same].reverse().find((b) => (b.along as number) <= (base.along as number));
  const after = same.find((b) => (b.along as number) >= (base.along as number));
  const out = [after, before].filter((b): b is BuildingInfo => b !== undefined && Math.abs((b.along as number) - (base.along as number)) <= BESIDE_REACH_M);
  return out.sort((a, b) => Math.abs((a.along as number) - (base.along as number)) - Math.abs((b.along as number) - (base.along as number)) || a.id - b.id).map((b) => ({ coordinate: b.center, radiusM: 25, building: b.id }));
}

export function cornerOf(base: BuildingInfo, around: BuildingInfo[]): Target | null {
  const corners = [base, ...around].filter((b) => b.secondChain !== null && distanceM(b.center, base.center) <= CORNER_REACH_M);
  if (corners.length === 0) return null;
  const best = corners.sort((a, b) => distanceM(a.center, base.center) - distanceM(b.center, base.center) || a.id - b.id)[0] as BuildingInfo;
  return { coordinate: best.center, radiusM: 30, building: best.id };
}

function nearestOnLines(point: LngLat, lines: LngLat[][]): LngLat | null {
  const k = Math.cos((point[1] * Math.PI) / 180) * M_PER_DEGREE;
  let best: LngLat | null = null;
  let bestD = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1] as LngLat;
      const b = line[i] as LngLat;
      const dx = (b[0] - a[0]) * k;
      const dy = (b[1] - a[1]) * M_PER_DEGREE;
      const length = dx * dx + dy * dy;
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, (((point[0] - a[0]) * k) * dx + ((point[1] - a[1]) * M_PER_DEGREE) * dy) / length));
      const q: LngLat = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const d = Math.hypot((point[0] - q[0]) * k, (point[1] - q[1]) * M_PER_DEGREE);
      if (d < bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  return best;
}

export function behindOf(base: BuildingInfo, lines: LngLat[][]): Target | null {
  const foot = nearestOnLines(base.center, lines);
  if (!foot) return null;
  const k = Math.cos((base.center[1] * Math.PI) / 180) * M_PER_DEGREE;
  const dx = (base.center[0] - foot[0]) * k;
  const dy = (base.center[1] - foot[1]) * M_PER_DEGREE;
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return null;
  const step = BEHIND_STEP_M;
  return { coordinate: [base.center[0] + (dx / length) * (step / k), base.center[1] + (dy / length) * (step / M_PER_DEGREE)], radiusM: 60, building: null };
}
