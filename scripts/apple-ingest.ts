import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { ORIGIN_APPLE, type StreetHint } from '../src/core/learned/types';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import { WAYS_DIRS, type Judged } from './apple-judge';
import type { AppleQuery } from './apple-queries';
import { displayName } from './hints-geo';

export const APPLE_HINT_RADIUS_M = 300;
const dist = join(repoRoot, 'dist', 'apple');
const jsonl = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);

export function appleHintsOf(queries: readonly AppleQuery[], judged: readonly Judged[]): StreetHint[] {
  const byId = new Map(queries.map((q) => [q.id, q]));
  const out = new Map<string, StreetHint>();
  for (const j of judged) {
    const q = byId.get(j.id);
    if (!q || !j.apple || j.cls !== 'apple' || (j.tier !== 'A' && j.tier !== 'B') || !q.street) continue;
    if (j.set !== 'eksik' || (j.grain !== 'street' && j.grain !== 'door') || j.why.includes('kismi-ad')) continue;
    const key = `${nameKey(q.district)}|${streetKey(q.street).key}`;
    const have = out.get(key);
    if (have && (j.tier === 'B' || have.sources >= 2)) continue;
    out.set(key, { district: nameKey(q.district), name: displayName(q.street), point: [Math.round(j.apple.point[0] * 1e6) / 1e6, Math.round(j.apple.point[1] * 1e6) / 1e6], radiusM: APPLE_HINT_RADIUS_M, sources: j.tier === 'A' ? 2 : 1, origin: ORIGIN_APPLE });
  }
  return [...out.values()].sort((a, b) => (a.district + a.name < b.district + b.name ? -1 : 1));
}

export function appleHints(plate: string): StreetHint[] {
  return appleHintsOf(jsonl<AppleQuery>(join(dist, 'queries', `${plate}.jsonl`)), jsonl<Judged>(join(dist, 'judged', `${plate}.jsonl`)));
}

export function directoryStreets(file: string): Set<string> {
  if (!existsSync(file)) return new Set();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return new Set((db.prepare('SELECT DISTINCT d.key dk, s.key sk FROM address a JOIN street_name s ON s.id = a.street_id JOIN district d ON d.id = a.district_id').all() as { dk: string; sk: string }[]).map((r) => `${r.dk}|${r.sk}`));
  } finally {
    db.close();
  }
}

export function addApple(base: readonly StreetHint[], extra: readonly StreetHint[], avoid: ReadonlySet<string> = new Set()): { hints: StreetHint[]; added: number; skipped: number } {
  const id = (h: StreetHint): string => `${h.district}|${streetKey(h.name).key}`;
  const out = new Map(base.map((h) => [id(h), h]));
  let added = 0;
  let skipped = 0;
  for (const e of extra) {
    if (out.has(id(e)) || avoid.has(id(e))) {
      skipped++;
      continue;
    }
    out.set(id(e), e);
    added++;
  }
  return { hints: [...out.values()].sort((a, b) => (a.district + a.name < b.district + b.name ? -1 : 1)), added, skipped };
}


export const MIN_WAY_DOORS = 4;
const MAX_LINE_POINTS = 60;
const SPIKE_M = 300;
const WAY_PAD_M = 60;
const WAY_MIN_RADIUS_M = 80;
const WAY_MAX_RADIUS_M = 300;
const REPLACE_PAD_M = 200;

type Door = { number: number; point: LngLat };

export function dropSpikes(doors: readonly Door[]): Door[] {
  if (doors.length < 3) return [...doors];
  const steps = doors.slice(1).map((d, i) => distanceM(doors[i]!.point, d.point)).sort((a, b) => a - b);
  const typical = Math.max(steps[Math.floor(steps.length / 2)] ?? 0, 30);
  return doors.filter((d, i) => {
    const before = i > 0 ? distanceM(doors[i - 1]!.point, d.point) : null;
    const after = i < doors.length - 1 ? distanceM(d.point, doors[i + 1]!.point) : null;
    const far = (m: number | null): boolean => m !== null && m > Math.max(SPIKE_M, 3 * typical);
    return !(far(before) && far(after)) && !(before === null && far(after) && doors.length > 3) && !(after === null && far(before) && doors.length > 3);
  });
}

export function wayHintOf(district: string, name: string, doors: readonly Door[]): StreetHint | null {
  const sorted = dropSpikes([...doors].sort((a, b) => a.number - b.number));
  const unique = sorted.filter((d, i) => i === 0 || d.number !== sorted[i - 1]!.number);
  if (unique.length < MIN_WAY_DOORS) return null;
  const along = [0];
  for (let i = 1; i < unique.length; i++) along.push(along[i - 1]! + distanceM(unique[i - 1]!.point, unique[i]!.point));
  const centre: LngLat = [unique.reduce((s, d) => s + d.point[0], 0) / unique.length, unique.reduce((s, d) => s + d.point[1], 0) / unique.length];
  const reach = Math.max(...unique.map((d) => distanceM(centre, d.point)));
  const stride = Math.max(1, Math.ceil(unique.length / MAX_LINE_POINTS));
  const keep = unique.map((d, i) => ({ d, i })).filter(({ i }) => i % stride === 0 || i === unique.length - 1);
  return {
    district,
    name,
    point: [Math.round(centre[0] * 1e6) / 1e6, Math.round(centre[1] * 1e6) / 1e6],
    radiusM: Math.round(Math.min(WAY_MAX_RADIUS_M, Math.max(WAY_MIN_RADIUS_M, reach + WAY_PAD_M))),
    sources: unique.length,
    origin: ORIGIN_APPLE,
    way: { line: keep.map(({ d }): LngLat => [Math.round(d.point[0] * 1e6) / 1e6, Math.round(d.point[1] * 1e6) / 1e6]), doors: keep.map(({ d, i }): [number, number] => [d.number, Math.round(along[i]!)]) },
  };
}

export function appleWaysOf(queries: readonly AppleQuery[], judged: readonly Judged[]): StreetHint[] {
  const byId = new Map(queries.map((q) => [q.id, q]));
  const groups = new Map<string, { district: string; street: string; doors: Door[] }>();
  for (const j of judged) {
    const q = byId.get(j.id);
    if (!q || !j.apple || !q.street || !q.number || (j.tier !== 'A' && j.tier !== 'B') || j.grain !== 'door' || j.why.includes('kismi-ad')) continue;
    const key = `${nameKey(q.district)}|${streetKey(q.street).key}`;
    const g = groups.get(key) ?? { district: nameKey(q.district), street: q.street, doors: [] };
    g.doors.push({ number: Number(q.number), point: j.apple.point });
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => wayHintOf(g.district, displayName(g.street), g.doors)).filter((h): h is StreetHint => h !== null).sort((a, b) => (a.district + a.name < b.district + b.name ? -1 : 1));
}

export function appleWays(plate: string): StreetHint[] {
  return appleWaysOf(jsonl<AppleQuery>(join(WAYS_DIRS.queries, `${plate}.jsonl`)), jsonl<Judged>(join(WAYS_DIRS.judged, `${plate}.jsonl`)));
}

export function applyWays(base: readonly StreetHint[], ways: readonly StreetHint[]): { hints: StreetHint[]; replaced: number; added: number; conflicts: number } {
  const id = (h: StreetHint): string => `${h.district}|${streetKey(h.name).key}`;
  const out = new Map(base.map((h) => [id(h), h]));
  let replaced = 0;
  let added = 0;
  let conflicts = 0;
  for (const w of ways) {
    const have = out.get(id(w));
    if (!have) {
      out.set(id(w), w);
      added++;
    } else if (have.way) conflicts++;
    else if (distanceM(have.point, w.point) <= have.radiusM + w.radiusM + REPLACE_PAD_M) {
      out.set(id(w), w);
      replaced++;
    } else conflicts++;
  }
  return { hints: [...out.values()].sort((a, b) => (a.district + a.name < b.district + b.name ? -1 : 1)), replaced, added, conflicts };
}
