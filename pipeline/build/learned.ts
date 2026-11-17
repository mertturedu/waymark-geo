import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { blockKey } from '../../src/core/address/unit';
import type { Components } from '../../src/core/address/types';
import type { LngLat } from '../../src/core/geo/cells';
import { distanceM } from '../../src/core/geo/distance';
import { composeKey, layerKeyOf } from '../../src/core/learn/key';
import { mergeConfirmations, TRUST_SPREAD_M } from '../../src/core/learn/merge';
import type { Confirmation } from '../../src/core/learn/types';
import { fitLayout, layoutKey, MIN_FIT, type FloorDoor } from '../../src/core/learned/layout';
import { LEARNED_APPLICATION_ID, LEARNED_FORMAT, LEARNED_SCHEMA, LEARNED_USER_VERSION, type ExtraDoor, type StreetHint } from '../../src/core/learned/types';
import { nameKey } from '../../src/core/text/fold';
import { floorDoor, type DeliveryRecord } from '../real/records';

export const DECAY_WEEKS = 26;
export const MIN_SOURCES_AGAINST_OSM = 3;
export const OSM_CONFLICT_M = 25;
export const MIN_LAYOUT_SOURCES = 2;
export const MIN_NAME_RECORDS = 3;
export const MIN_NAME_SOURCES = 2;
export const NAME_SPREAD_M = 100;
export const ENTRANCE_JOIN_M = 12;
export const MAX_ENTRANCES = 4;
export const MIN_ENTRANCE_SOURCES = 2;
const WEEK_SECONDS = 7 * 24 * 3600;
const PIN_ACCURACY_M = 5;
const STOP_ACCURACY_M = 5;
const PIN_WITH_STOP_ACCURACY_M = 12;
export const PIN_WITH_STOP_M = 30;
const MAX_ACCURACY_M = 10_000;
const MIN_HINT_RADIUS_M = 40;
const MAX_HINT_RADIUS_M = 300;
const HINT_PAD_M = 20;
const LAYOUT_SOLO_SAMPLES = 6;

export type LearnedInput = {
  plate: string;
  records: readonly DeliveryRecord[];
  nowWeek: number;
  outFile: string;
  osmPoint?: (probe: Components) => Promise<LngLat | null> | LngLat | null;
  snap?: (point: LngLat) => Promise<LngLat> | LngLat;
  streetKnown?: (district: string, street: string) => boolean;
  extraHints?: readonly StreetHint[];
  extraDoors?: readonly ExtraDoor[];
  withoutOrigin?: readonly number[];
};

export type LearnedStats = {
  records: number;
  keys: number;
  trusted: number;
  untrusted: number;
  outlierPoints: number;
  conflictsKept: number;
  conflictsWon: number;
  noKey: number;
  layouts: number;
  layoutsDropped: number;
  entrances: number;
  hints: number;
  stopsUsed: number;
  pinsDroppedForStop: number;
  bytes: number;
};

type Entry = { probe: Components; confirmations: Confirmation[]; srcs: string[] };
type Layer = { pairs: FloorDoor[]; srcs: Set<string>; entrances: { point: LngLat; src: string }[] };

const decayed = (accuracy: number, age: number): number => Math.min(MAX_ACCURACY_M, accuracy / Math.sqrt(0.5 ** (Math.max(0, age) / DECAY_WEEKS)));
const micro = (n: number): number => Math.round(n * 1e6);
const sorted = <T>(map: Map<string, T>): [string, T][] => [...map].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

function confirmationsOf(r: DeliveryRecord, now: number): { list: { c: Confirmation; src: string }[]; droppedPin: boolean } {
  const at = r.week * WEEK_SECONDS;
  const age = now - r.week;
  const make = (source: Confirmation['source'], p: { lng: number; lat: number }, accuracy: number): { c: Confirmation; src: string } => ({ c: { source, lng: p.lng, lat: p.lat, accuracyM: decayed(accuracy, age), at }, src: r.src });
  if (r.stop) {
    const list = [make('delivery', r.stop, STOP_ACCURACY_M)];
    const agrees = r.pin !== undefined && distanceM([r.pin.lng, r.pin.lat], [r.stop.lng, r.stop.lat]) <= PIN_WITH_STOP_M;
    if (r.pin && agrees) list.push(make('pin', r.pin, PIN_WITH_STOP_ACCURACY_M));
    return { list, droppedPin: r.pin !== undefined && !agrees };
  }
  const list: { c: Confirmation; src: string }[] = [];
  if (r.pin) list.push(make('pin', r.pin, PIN_ACCURACY_M));
  if (r.gps) list.push(make('delivery', r.gps, r.gps.accuracyM));
  return { list, droppedPin: false };
}

function agreeing(inliers: Confirmation[]): boolean {
  const pins = inliers.filter((c) => c.source === 'pin');
  const others = inliers.filter((c) => c.source !== 'pin');
  return pins.some((p) => others.some((o) => distanceM([p.lng, p.lat], [o.lng, o.lat]) <= TRUST_SPREAD_M));
}

function cluster(points: { point: LngLat; src: string }[]): { point: LngLat; sources: number }[] {
  const groups: { sum: [number, number]; n: number; srcs: Set<string> }[] = [];
  for (const p of [...points].sort((a, b) => a.point[0] - b.point[0] || a.point[1] - b.point[1])) {
    const hit = groups.find((g) => distanceM([g.sum[0] / g.n, g.sum[1] / g.n], p.point) <= ENTRANCE_JOIN_M);
    if (hit) {
      hit.sum = [hit.sum[0] + p.point[0], hit.sum[1] + p.point[1]];
      hit.n++;
      hit.srcs.add(p.src);
    } else groups.push({ sum: [p.point[0], p.point[1]], n: 1, srcs: new Set([p.src]) });
  }
  return groups.map((g) => ({ point: [g.sum[0] / g.n, g.sum[1] / g.n] as LngLat, sources: g.srcs.size })).filter((g) => g.sources >= MIN_ENTRANCE_SOURCES).sort((a, b) => b.sources - a.sources || a.point[0] - b.point[0]).slice(0, MAX_ENTRANCES);
}

function hintsOf(records: readonly DeliveryRecord[], known: (district: string, street: string) => boolean): StreetHint[] {
  const groups = new Map<string, { district: string; names: Map<string, number>; points: { point: LngLat; src: string }[] }>();
  for (const r of records) {
    const at = r.stop ?? r.pin ?? r.gps;
    if (!r.street || !at || known(r.district, r.street)) continue;
    const district = nameKey(r.district);
    const key = `${district}|${nameKey(r.street)}`;
    const g = groups.get(key) ?? { district, names: new Map<string, number>(), points: [] as { point: LngLat; src: string }[] };
    g.names.set(r.street, (g.names.get(r.street) ?? 0) + 1);
    g.points.push({ point: [at.lng, at.lat], src: r.src });
    groups.set(key, g);
  }
  const out: StreetHint[] = [];
  for (const [, g] of sorted(groups)) {
    const lng = [...g.points].map((p) => p.point[0]).sort((a, b) => a - b);
    const lat = [...g.points].map((p) => p.point[1]).sort((a, b) => a - b);
    const mid: LngLat = [lng[Math.floor(lng.length / 2)] as number, lat[Math.floor(lat.length / 2)] as number];
    const near = g.points.filter((p) => distanceM(p.point, mid) <= NAME_SPREAD_M);
    const sources = new Set(near.map((p) => p.src)).size;
    if (near.length < MIN_NAME_RECORDS || sources < MIN_NAME_SOURCES) continue;
    const centre: LngLat = [near.reduce((s, p) => s + p.point[0], 0) / near.length, near.reduce((s, p) => s + p.point[1], 0) / near.length];
    const spread = Math.max(...near.map((p) => distanceM(p.point, centre)));
    const name = [...g.names].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] as string;
    out.push({ district: g.district, name, point: centre, radiusM: Math.round(Math.min(MAX_HINT_RADIUS_M, Math.max(MIN_HINT_RADIUS_M, spread + HINT_PAD_M))), sources });
  }
  return out;
}

export async function buildLearned(input: LearnedInput): Promise<LearnedStats> {
  const stats: LearnedStats = { records: input.records.length, keys: 0, trusted: 0, untrusted: 0, outlierPoints: 0, conflictsKept: 0, conflictsWon: 0, noKey: 0, layouts: 0, layoutsDropped: 0, entrances: 0, hints: 0, stopsUsed: 0, pinsDroppedForStop: 0, bytes: 0 };
  const entries = new Map<string, Entry>();
  const layers = new Map<string, Layer>();
  for (const r of input.records) {
    if (r.region !== input.plate) continue;
    const probe: Components = { district: r.district, ...(r.neighbourhood ? { neighbourhood: r.neighbourhood } : {}), ...(r.street ? { street: r.street } : {}), houseNumber: r.houseNumber };
    const parts = layerKeyOf(r.region, probe);
    if (!parts) {
      stats.noKey++;
      continue;
    }
    const key = composeKey(parts);
    const entry = entries.get(key) ?? { probe, confirmations: [], srcs: [] };
    const made = confirmationsOf(r, input.nowWeek);
    if (r.stop) stats.stopsUsed++;
    if (made.droppedPin) stats.pinsDroppedForStop++;
    for (const { c, src } of made.list) {
      entry.confirmations.push(c);
      entry.srcs.push(src);
    }
    entries.set(key, entry);
    const lk = layoutKey(key, r.block ? blockKey(r.block) : null);
    const layer = layers.get(lk) ?? { pairs: [], srcs: new Set<string>(), entrances: [] };
    const pair = floorDoor(r);
    if (pair) {
      layer.pairs.push(pair);
      layer.srcs.add(r.src);
    }
    if (r.entrance) layer.entrances.push({ point: [r.entrance.lng, r.entrance.lat], src: r.src });
    layers.set(lk, layer);
  }

  const doors: { key: string; coordinate: LngLat; trusted: boolean; sources: number; spread: number; origin: number }[] = [];
  for (const [key, entry] of sorted(entries)) {
    const merged = mergeConfirmations(entry.confirmations);
    if (!merged) continue;
    const used = new Set(merged.outliers);
    const inliers = entry.confirmations.filter((_, i) => !used.has(i));
    stats.outlierPoints += merged.outliers.length;
    const sources = new Set(entry.srcs.filter((_, i) => !used.has(i))).size;
    let trusted = (sources >= 2 && merged.spreadM < TRUST_SPREAD_M) || agreeing(inliers);
    const coordinate = input.snap ? await input.snap(merged.coordinate) : merged.coordinate;
    const osm = (await input.osmPoint?.(entry.probe)) ?? null;
    if (osm && distanceM(osm, coordinate) > OSM_CONFLICT_M) {
      if (sources >= MIN_SOURCES_AGAINST_OSM) stats.conflictsWon++;
      else {
        trusted = false;
        stats.conflictsKept++;
      }
    }
    if (trusted) stats.trusted++;
    else stats.untrusted++;
    doors.push({ key, coordinate, trusted, sources, spread: Math.round(merged.spreadM), origin: 0 });
  }
  const skippedOrigins = new Set(input.withoutOrigin ?? []);
  const doorKeys = new Set(doors.map((d) => d.key));
  for (const e of [...(input.extraDoors ?? [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))) {
    if (doorKeys.has(e.key) || skippedOrigins.has(e.origin)) continue;
    doorKeys.add(e.key);
    doors.push({ key: e.key, coordinate: e.point, trusted: false, sources: 1, spread: 0, origin: e.origin });
  }
  doors.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  stats.keys = doors.length;

  const layouts: { key: string; row: NonNullable<ReturnType<typeof fitLayout>> }[] = [];
  const entrances: { key: string; idx: number; point: LngLat; sources: number }[] = [];
  for (const [key, layer] of sorted(layers)) {
    const base = key.split('#')[0] as string;
    if (!entries.has(base)) continue;
    if (layer.srcs.size >= MIN_LAYOUT_SOURCES) {
      const row = fitLayout(layer.pairs);
      if (row && (row.fit >= MIN_FIT || row.samples >= LAYOUT_SOLO_SAMPLES)) layouts.push({ key, row });
      else stats.layoutsDropped++;
    }
    cluster(layer.entrances).forEach((e, idx) => entrances.push({ key, idx, point: e.point, sources: e.sources }));
  }
  stats.layouts = layouts.length;
  stats.entrances = entrances.length;
  const own = input.streetKnown ? hintsOf(input.records.filter((r) => r.region === input.plate), input.streetKnown) : [];
  const taken = new Set(own.map((h) => `${h.district}|${nameKey(h.name)}`));
  const skipped = new Set(input.withoutOrigin ?? []);
  const hints = [...own, ...(input.extraHints ?? []).filter((h) => !taken.has(`${h.district}|${nameKey(h.name)}`) && !skipped.has(h.origin ?? 0))];
  stats.hints = hints.length;

  mkdirSync(dirname(input.outFile), { recursive: true });
  const temporary = `${input.outFile}.tmp`;
  rmSync(temporary, { force: true });
  const db = new DatabaseSync(temporary);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
  for (const sql of LEARNED_SCHEMA) db.exec(sql);
  db.exec('BEGIN');
  const put = (sql: string, ...params: (string | number)[][]): void => {
    const statement = db.prepare(sql);
    for (const p of params) statement.run(...p);
  };
  put('INSERT INTO meta (key, value) VALUES (?, ?)', ['format', LEARNED_FORMAT], ['region', input.plate], ['doors', String(doors.length)], ['layouts', String(layouts.length)]);
  put('INSERT INTO door (key, lng, lat, trusted, sources, spread, origin) VALUES (?, ?, ?, ?, ?, ?, ?)', ...doors.map((d) => [d.key, micro(d.coordinate[0]), micro(d.coordinate[1]), d.trusted ? 1 : 0, d.sources, d.spread, d.origin]));
  put('INSERT INTO layout (key, per, basement, floors, fit, samples, ranges) VALUES (?, ?, ?, ?, ?, ?, ?)', ...layouts.map((l) => [l.key, l.row.perFloor, l.row.basement, l.row.floors, Math.round(l.row.fit * 100), l.row.samples, JSON.stringify(l.row.ranges)]));
  put('INSERT INTO entrance (key, idx, lng, lat, sources) VALUES (?, ?, ?, ?, ?)', ...entrances.map((e) => [e.key, e.idx, micro(e.point[0]), micro(e.point[1]), e.sources]));
  put('INSERT INTO hint (district, name, lng, lat, radius, sources, origin) VALUES (?, ?, ?, ?, ?, ?, ?)', ...hints.map((h) => [h.district, h.name, micro(h.point[0]), micro(h.point[1]), h.radiusM, h.sources, h.origin ?? 0]));
  put('INSERT INTO way (district, name, line, doors) VALUES (?, ?, ?, ?)', ...hints.filter((h) => h.way).map((h) => [h.district, h.name, JSON.stringify(h.way!.line.map((q) => [micro(q[0]), micro(q[1])])), JSON.stringify(h.way!.doors)]));
  db.exec('COMMIT');
  db.exec(`PRAGMA user_version = ${LEARNED_USER_VERSION}; PRAGMA application_id = ${LEARNED_APPLICATION_ID};`);
  db.close();
  renameSync(temporary, input.outFile);
  return { ...stats, bytes: statSync(input.outFile).size };
}
