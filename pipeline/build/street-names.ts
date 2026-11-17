import { nameKey, parseAddress } from '../../src/core/text';
import { nameScore } from '../../src/core/address/names';
import { streetKey } from '../../src/core/text/street';
import type { WordKind } from '../../src/core/text/types';

export type Line = [number, number][];
export type Way = { id: string; lines: Line[]; [extra: string]: unknown };
export type NamedPart = { name: string; lines: Line[] };
export type Business = { id: string; name: string; brand: string | null; lon: number; lat: number; addr: string };

export type Options = { nearM: number; sameNameM: number; minBusinesses: number };
export const OPTIONS: Options = { nearM: 40, sameNameM: 150, minBusinesses: 3 };

export type Evidence1 = { lon: number; lat: number; number: string };
export type Derived = { wayId: string; name: string; key: string; support: number; evidence: Evidence1[] };

const CELL = 0.0006;
const DISSENT_RATIO = 8;
const MIN_SPREAD_M = 30;
const M_PER_DEGREE = 111_320;
const LABEL: Partial<Record<WordKind, string>> = { sokak: 'Sokağı', cadde: 'Caddesi', bulvar: 'Bulvarı', cikmaz: 'Çıkmazı', yol: 'Yolu', meydan: 'Meydanı' };

type Grid<T> = Map<string, T[]>;

const cellOf = (lon: number, lat: number): string => `${Math.floor(lon / CELL)}:${Math.floor(lat / CELL)}`;

function put<T>(grid: Grid<T>, lon: number, lat: number, value: T): void {
  const key = cellOf(lon, lat);
  const list = grid.get(key);
  if (list) list.push(value);
  else grid.set(key, [value]);
}

function around<T>(grid: Grid<T>, lon: number, lat: number, rings: number): T[] {
  const cx = Math.floor(lon / CELL);
  const cy = Math.floor(lat / CELL);
  const out: T[] = [];
  for (let dx = -rings; dx <= rings; dx++) for (let dy = -rings; dy <= rings; dy++) out.push(...(grid.get(`${cx + dx}:${cy + dy}`) ?? []));
  return out;
}

function distanceToSegmentM(px: number, py: number, a: [number, number], b: [number, number]): number {
  const scale = Math.cos((py * Math.PI) / 180);
  const ax = (a[0] - px) * M_PER_DEGREE * scale;
  const ay = (a[1] - py) * M_PER_DEGREE;
  const bx = (b[0] - px) * M_PER_DEGREE * scale;
  const by = (b[1] - py) * M_PER_DEGREE;
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToLinesM(lon: number, lat: number, lines: Line[]): number {
  let best = Infinity;
  for (const line of lines) for (let i = 1; i < line.length; i++) best = Math.min(best, distanceToSegmentM(lon, lat, line[i - 1] as [number, number], line[i] as [number, number]));
  return best;
}

const titleCase = (word: string): string => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR');

export type Spoken = { key: string; text: string; kind: WordKind | null; number: string };

export function streetOf(addr: string): Spoken | null {
  const parsed = parseAddress(addr);
  const street = parsed.street;
  if (!street || street.number !== null || street.text.trim() === '' || parsed.houseNumber === null) return null;
  const words = street.text.split(' ');
  const raw = addr.split(/[\s,;]+/).filter(Boolean);
  const folded = raw.map((token) => nameKey(token));
  for (let i = 0; i + words.length <= raw.length; i++) {
    if (words.every((w, k) => folded[i + k] === w)) return { key: streetKey(street.text).key, text: raw.slice(i, i + words.length).map(titleCase).join(' '), kind: street.kind, number: parsed.houseNumber };
  }
  return { key: streetKey(street.text).key, text: words.map(titleCase).join(' '), kind: street.kind, number: parsed.houseNumber };
}

export type Evidence = { grid: Grid<{ business: Business; spoken: Spoken }> };

export function evidenceOf(businesses: Business[]): Evidence {
  const grid: Evidence['grid'] = new Map();
  for (const business of businesses) {
    const spoken = streetOf(business.addr);
    if (spoken) put(grid, business.lon, business.lat, { business, spoken });
  }
  return { grid };
}

export type NamedPoint = { lon: number; lat: number; key: string };
export type NamedIndex = { grid: Grid<NamedPoint> };

export function namedIndexOf(parts: NamedPart[], step = 0.00025): NamedIndex {
  const grid: NamedIndex['grid'] = new Map();
  for (const part of parts) {
    const key = streetKey(part.name).key;
    for (const line of part.lines) {
      for (let i = 0; i < line.length; i++) {
        const a = line[i] as [number, number];
        put(grid, a[0], a[1], { lon: a[0], lat: a[1], key });
        const b = line[i + 1];
        if (!b) continue;
        const pieces = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
        for (let k = 1; k <= pieces; k++) {
          const lon = a[0] + ((b[0] - a[0]) * k) / (pieces + 1);
          const lat = a[1] + ((b[1] - a[1]) * k) / (pieces + 1);
          put(grid, lon, lat, { lon, lat, key });
        }
      }
    }
  }
  return { grid };
}

const nearNamed = (index: NamedIndex, way: Way, key: string): boolean => {
  const rings = 2;
  for (const line of way.lines) for (const p of line) if (around(index.grid, p[0], p[1], rings).some((n) => n.key === key)) return true;
  return false;
};

const metres = (aLon: number, aLat: number, bLon: number, bLat: number): number => Math.hypot((aLon - bLon) * M_PER_DEGREE * Math.cos((aLat * Math.PI) / 180), (aLat - bLat) * M_PER_DEGREE);

function businessFits(index: NamedIndex, business: Business, spoken: Spoken, wayDistance: number, hidden: string | null, options: Options): boolean {
  let nearest = Infinity;
  for (const n of around(index.grid, business.lon, business.lat, 1)) {
    const d = metres(business.lon, business.lat, n.lon, n.lat);
    if (n.key === spoken.key && spoken.key !== hidden && d <= options.sameNameM) return false;
    if (n.key !== hidden) nearest = Math.min(nearest, d);
  }
  return wayDistance <= nearest;
}

function nearbyBusinesses(evidence: Evidence, way: Way, nearM: number): { business: Business; spoken: Spoken; wayDistance: number }[] {
  const seen = new Set<string>();
  const out: { business: Business; spoken: Spoken; wayDistance: number }[] = [];
  for (const line of way.lines) {
    for (const p of line) {
      for (const item of around(evidence.grid, p[0], p[1], 1)) {
        if (seen.has(item.business.id)) continue;
        seen.add(item.business.id);
        const wayDistance = distanceToLinesM(item.business.lon, item.business.lat, way.lines);
        if (wayDistance <= nearM) out.push({ ...item, wayDistance });
      }
    }
  }
  return out;
}

function spread(spots: [number, number][]): number {
  let widest = 0;
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) widest = Math.max(widest, metres((spots[i] as [number, number])[0], (spots[i] as [number, number])[1], (spots[j] as [number, number])[0], (spots[j] as [number, number])[1]));
  return widest;
}

const independentName = (business: Business): string => nameKey(business.brand ?? business.name);

export function deriveFor(way: Way, evidence: Evidence, named: NamedIndex, options: Options = OPTIONS, hidden: string | null = null): Derived | null {
  const groups = new Map<string, { names: Set<string>; texts: Map<string, number>; kind: WordKind | null; spots: [number, number][]; numbers: Evidence1[] }>();
  for (const { business, spoken, wayDistance } of nearbyBusinesses(evidence, way, options.nearM)) {
    if (!businessFits(named, business, spoken, wayDistance, hidden, options)) continue;
    const group = groups.get(spoken.key) ?? { names: new Set<string>(), texts: new Map<string, number>(), kind: spoken.kind, spots: [], numbers: [] };
    group.spots.push([business.lon, business.lat]);
    group.numbers.push({ lon: business.lon, lat: business.lat, number: spoken.number });
    group.names.add(independentName(business));
    group.texts.set(spoken.text, (group.texts.get(spoken.text) ?? 0) + 1);
    if (group.kind === null) group.kind = spoken.kind;
    groups.set(spoken.key, group);
  }
  const strong = [...groups].filter(([, g]) => g.names.size >= options.minBusinesses);
  if (strong.length !== 1) return null;
  const [key, group] = strong[0] as [string, (typeof strong)[number][1]];
  if (spread(group.spots) < MIN_SPREAD_M) return null;
  const dissent = [...groups].filter(([other]) => other !== key).reduce((sum, [, g]) => sum + g.names.size, 0);
  if (dissent > Math.floor(group.names.size / DISSENT_RATIO)) return null;
  if (key !== hidden && nearNamed(named, way, key)) return null;
  const text = [...group.texts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? key;
  const label = group.kind ? LABEL[group.kind] : undefined;
  const name = label && !nameKey(text).split(' ').includes(nameKey(label)) ? `${text} ${label}` : text;
  return { wayId: way.id, name, key, support: group.names.size, evidence: group.numbers.slice(0, 5) };
}

export function deriveNames(ways: Way[], businesses: Business[], named: NamedPart[], options: Options = OPTIONS): Derived[] {
  const evidence = evidenceOf(businesses);
  const index = namedIndexOf(named);
  const out: Derived[] = [];
  for (const way of ways) {
    const found = deriveFor(way, evidence, index, options);
    if (found) out.push(found);
  }
  return out;
}

export const sameStreetName = (a: string, b: string): boolean => nameScore(streetKey(a), streetKey(b)).score >= 0.88;

export type Validation = { tried: number; proposed: number; correct: number; precision: number; coverage: number };

export function validate(namedWays: { part: NamedPart; way: Way }[], businesses: Business[], allNamed: NamedPart[], options: Options = OPTIONS): Validation {
  const evidence = evidenceOf(businesses);
  const index = namedIndexOf(allNamed);
  let proposed = 0;
  let correct = 0;
  for (const { part, way } of namedWays) {
    const truth = streetKey(part.name).key;
    const found = deriveFor(way, evidence, index, options, truth);
    if (!found) continue;
    proposed++;
    if (found.key === truth || sameStreetName(found.name, part.name)) correct++;
  }
  return { tried: namedWays.length, proposed, correct, precision: proposed === 0 ? 1 : correct / proposed, coverage: namedWays.length === 0 ? 0 : proposed / namedWays.length };
}
