import type { LayerKey, LayerNeighbour, LayerPoint, LayerScope } from '../address/types';
import type { LngLat } from '../geo/cells';
import { composeKey, scopeKey, scopeOfKey } from '../learn/key';
import type { SqlDb } from '../ports';
import { LEARNED_FORMAT, type BuildingLayout, type FloorRange, type LearnedEntrance, type StreetHint, type StreetWay } from './types';

export type LearnedPack = {
  lookup(key: LayerKey): Promise<LayerPoint | null>;
  nearby(scope: LayerScope): Promise<LayerNeighbour[]>;
  layout(key: string): Promise<BuildingLayout | null>;
  entrances(key: string): Promise<LearnedEntrance[]>;
  hints(district: string): Promise<StreetHint[]>;
};

type DoorRow = { lng: number; lat: number; trusted: number };
type NearRow = { key: string; lng: number; lat: number; trusted: number };
type LayoutRow = { per: number; basement: number; floors: number; fit: number; samples: number; ranges: string };

const point = (lng: number, lat: number): LngLat => [lng / 1e6, lat / 1e6];

function parseRanges(text: string): FloorRange[] {
  try {
    const raw: unknown = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is FloorRange => Array.isArray(r) && r.length === 3 && r.every((n) => Number.isInteger(n)));
  } catch {
    return [];
  }
}

function parseWay(line: string, doors: string): StreetWay | undefined {
  try {
    const l: unknown = JSON.parse(line);
    const d: unknown = JSON.parse(doors);
    if (!Array.isArray(l) || !Array.isArray(d) || l.length < 2) return undefined;
    const points = l.filter((q): q is [number, number] => Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number')).map((q): LngLat => [q[0] / 1e6, q[1] / 1e6]);
    const samples = d.filter((q): q is [number, number] => Array.isArray(q) && q.length === 2 && q.every((n) => typeof n === 'number'));
    return points.length >= 2 && samples.length > 0 ? { line: points, doors: samples } : undefined;
  } catch {
    return undefined;
  }
}

export async function openLearned(db: SqlDb): Promise<LearnedPack | null> {
  const meta = await db.all<{ value: string }>("SELECT value FROM meta WHERE key = 'format'").catch(() => []);
  if (meta[0]?.value !== LEARNED_FORMAT) return null;
  const hinted = new Map<string, Promise<StreetHint[]>>();
  let doors: Promise<boolean> | null = null;
  const hasDoors = (): Promise<boolean> => (doors ??= db.all<{ one: number }>('SELECT 1 AS one FROM door LIMIT 1').then((r) => r.length > 0));
  const readHints = async (district: string): Promise<StreetHint[]> => {
    const rows = await db.all<{ name: string; lng: number; lat: number; radius: number; sources: number }>('SELECT name, lng, lat, radius, sources FROM hint WHERE district = ? ORDER BY name', [district]);
    const ways = new Map((await db.all<{ name: string; line: string; doors: string }>('SELECT name, line, doors FROM way WHERE district = ?', [district]).catch(() => [])).map((w) => [w.name, parseWay(w.line, w.doors)]));
    return rows.map((r) => {
      const way = ways.get(r.name);
      return { district, name: r.name, point: point(r.lng, r.lat), radiusM: r.radius, sources: r.sources, ...(way ? { way } : {}) };
    });
  };
  return {
    async lookup(key) {
      if (!(await hasDoors())) return null;
      const rows = await db.all<DoorRow>('SELECT lng, lat, trusted FROM door WHERE key = ?', [composeKey(key)]);
      const row = rows[0];
      return row ? { coordinate: point(row.lng, row.lat), trusted: row.trusted === 1 } : null;
    },
    async nearby(scope) {
      if (!(await hasDoors())) return [];
      const prefix = scopeKey(scope);
      const rows = await db.all<NearRow>('SELECT key, lng, lat, trusted FROM door WHERE key >= ? AND key < ?', [`${prefix}|`, `${prefix}}`]);
      const out: LayerNeighbour[] = [];
      for (const r of rows) {
        const number = scopeOfKey(r.key);
        if (number) out.push({ int: number.int, coordinate: point(r.lng, r.lat), trusted: r.trusted === 1 });
      }
      return out.sort((a, b) => a.int - b.int);
    },
    async layout(key) {
      const row = (await db.all<LayoutRow>('SELECT per, basement, floors, fit, samples, ranges FROM layout WHERE key = ?', [key]))[0];
      return row ? { perFloor: row.per, basement: row.basement, floors: row.floors, fit: row.fit / 100, samples: row.samples, ranges: parseRanges(row.ranges) } : null;
    },
    async entrances(key) {
      const rows = await db.all<{ lng: number; lat: number; sources: number }>('SELECT lng, lat, sources FROM entrance WHERE key = ? ORDER BY idx', [key]);
      return rows.map((r) => ({ point: point(r.lng, r.lat), sources: r.sources }));
    },
    hints(district) {
      let found = hinted.get(district);
      if (!found) {
        found = readHints(district);
        hinted.set(district, found);
        found.catch(() => hinted.delete(district));
      }
      return found;
    },
  };
}
