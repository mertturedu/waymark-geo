import { formatLabel } from '../address/label';
import type { LayerKey, LayerNeighbour, LayerPoint, LayerScope, Place, PointLayer } from '../address/types';
import type { LngLat } from '../geo/cells';
import { composeKey, learnKey, scopeKey, scopeOfKey, textOfKey, validKey } from './key';
import { mergeConfirmations, type Merged } from './merge';
import { migrate } from './migrate';
import type { LearnStore } from './store';
import { SOURCES, type Confirmation, type ConfirmSource, type LearnedRecord, SCHEMA_VERSION } from './types';

export type ConfirmInput = { place: Place; houseNumber?: string; street?: string; point: LngLat; source: ConfirmSource; accuracyM?: number };
export type ConfirmResult = { ok: true; trusted: boolean; count: number } | { ok: false; reason: 'invalid-input' | 'invalid-point' | 'invalid-source' | 'no-key' | 'store-failed' };
export type ImportResult = { added: number; merged: number; skipped: number };
export type LearnStats = { keys: number; confirmations: number; damaged: number; newer: number };

export type Learning = {
  confirm(input: ConfirmInput): Promise<ConfirmResult>;
  layer: PointLayer;
  forget(key?: string): Promise<void>;
  exportLines(): string[];
  importLines(lines: string[]): Promise<ImportResult>;
  stats(): LearnStats;
};

const KEEP = 20;
const BACKUP = '~old:';
const MAX_COMPONENT = 200;
const COMPONENT_FIELDS = ['province', 'district', 'neighbourhood', 'street', 'houseNumber', 'building', 'door', 'postcode', 'poiName'];
const BOX = { west: 25.5, east: 45, south: 35.5, north: 42.5 };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const inBox = (lng: number, lat: number): boolean => Number.isFinite(lng) && Number.isFinite(lat) && lng >= BOX.west && lng <= BOX.east && lat >= BOX.south && lat <= BOX.north;
const idOf = (c: Confirmation): string => `${c.source},${c.lng},${c.lat},${c.at}`;

function recordOf(key: string, region: string, text: string, confirmations: Confirmation[]): LearnedRecord {
  const kept = confirmations
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.at - b.c.at || a.i - b.i)
    .map((e) => e.c)
    .slice(-KEEP)
    .map((c) => (c.accuracyM === undefined ? { source: c.source, lng: c.lng, lat: c.lat, at: c.at } : { source: c.source, lng: c.lng, lat: c.lat, accuracyM: c.accuracyM, at: c.at }));
  return { v: SCHEMA_VERSION, key, region, text, confirmations: kept };
}

function readInput(raw: unknown): { place: Place; point: LngLat; source: ConfirmSource; accuracyM?: number } | ConfirmResult {
  if (!isObject(raw) || !isObject(raw.place) || !isObject(raw.place.components) || typeof raw.place.region !== 'string') return { ok: false, reason: 'invalid-input' };
  const fields = raw.place.components as Record<string, unknown>;
  if (COMPONENT_FIELDS.some((f) => fields[f] !== undefined && (typeof fields[f] !== 'string' || (fields[f] as string).length > MAX_COMPONENT))) return { ok: false, reason: 'invalid-input' };
  const point = raw.point;
  if (!Array.isArray(point) || point.length < 2 || typeof point[0] !== 'number' || typeof point[1] !== 'number' || !inBox(point[0], point[1])) return { ok: false, reason: 'invalid-point' };
  if (typeof raw.source !== 'string' || !(SOURCES as readonly string[]).includes(raw.source)) return { ok: false, reason: 'invalid-source' };
  const accuracyM = typeof raw.accuracyM === 'number' && Number.isFinite(raw.accuracyM) && raw.accuracyM > 0 ? raw.accuracyM : undefined;
  const given = typeof raw.houseNumber === 'string' ? raw.houseNumber.trim() : '';
  if (typeof raw.street === 'string' && raw.street.length > MAX_COMPONENT) return { ok: false, reason: 'invalid-input' };
  const typedStreet = typeof raw.street === 'string' ? raw.street.trim() : '';
  const base = raw.place as Place;
  const native = base.local && typeof base.local === 'object' ? base.local : base.components;
  const place: Place = { ...base, components: { ...native, ...(given === '' ? {} : { houseNumber: given }), ...(native.street || typedStreet === '' ? {} : { street: typedStreet }) } };
  return { place, point: [point[0], point[1]], source: raw.source as ConfirmSource, accuracyM };
}

export async function createLearning(config: { store: LearnStore; now?: () => number; neighbours?: 'trusted' | 'all' }): Promise<Learning> {
  const records = new Map<string, LearnedRecord>();
  const merged = new Map<string, Merged>();
  const unreadable = new Map<string, { value: string; kind: 'damaged' | 'newer' }>();
  const backups = new Set<string>();
  const byScope = new Map<string, Map<string, number>>();
  let queue: Promise<unknown> = Promise.resolve();

  const clock = (): number => {
    const value = Math.floor((config.now ?? (() => Date.now() / 1000))());
    return Number.isFinite(value) ? value : 0;
  };

  const exclusive = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job);
    queue = next.catch(() => undefined);
    return next;
  };

  const hold = (record: LearnedRecord): void => {
    records.set(record.key, record);
    merged.set(record.key, mergeConfirmations(record.confirmations) as Merged);
    const at = scopeOfKey(record.key);
    if (at) byScope.set(at.scope, (byScope.get(at.scope) ?? new Map()).set(record.key, at.int));
  };

  const drop = (key: string): void => {
    records.delete(key);
    merged.delete(key);
    unreadable.delete(key);
    const at = scopeOfKey(key);
    const inScope = at ? byScope.get(at.scope) : undefined;
    if (at && inScope) {
      inScope.delete(key);
      if (inScope.size === 0) byScope.delete(at.scope);
    }
  };

  const sanitize = (key: string, record: LearnedRecord): LearnedRecord | null => {
    if (record.key !== key || !validKey(record.key, record.region)) return null;
    const usable = record.confirmations.filter((c) => inBox(c.lng, c.lat));
    return usable.length === 0 ? null : recordOf(record.key, record.region, record.text, usable);
  };

  for (const row of await config.store.readAll()) {
    if (row.key.startsWith(BACKUP)) {
      backups.add(row.key);
      continue;
    }
    const result = migrate(row.value);
    const clean = 'record' in result ? sanitize(row.key, result.record) : null;
    if (clean) hold(clean);
    else unreadable.set(row.key, { value: row.value, kind: 'skipped' in result ? result.skipped : 'damaged' });
  }

  const backupName = (key: string): string => {
    let name = `${BACKUP}${key}`;
    for (let n = 1; backups.has(name); n++) name = `${BACKUP}${key}#${n}`;
    return name;
  };

  const persist = async (record: LearnedRecord): Promise<boolean> => {
    const old = unreadable.get(record.key);
    try {
      if (old) {
        const name = backupName(record.key);
        await config.store.write(name, old.value);
        backups.add(name);
      }
      await config.store.write(record.key, JSON.stringify(record));
    } catch {
      return false;
    }
    unreadable.delete(record.key);
    hold(record);
    return true;
  };

  const layer: PointLayer = {
    name: 'learned',
    async lookup(key: LayerKey): Promise<LayerPoint | null> {
      const found = merged.get(composeKey(key));
      return found ? { coordinate: found.coordinate, trusted: found.trusted } : null;
    },
  };

  layer.nearby = async (scope: LayerScope): Promise<LayerNeighbour[]> => {
    const out: LayerNeighbour[] = [];
    for (const [key, int] of byScope.get(scopeKey(scope)) ?? []) {
      const found = merged.get(key) as Merged;
      if (config.neighbours === 'trusted' && !found.trusted) continue;
      out.push({ int, coordinate: found.coordinate, trusted: found.trusted });
    }
    return out.sort((a, b) => a.int - b.int);
  };

  const confirmOnce = async (raw: unknown): Promise<ConfirmResult> => {
    const read = readInput(raw);
    if ('ok' in read) return read;
    const key = learnKey(read.place);
    if (key === null || !validKey(key, read.place.region)) return { ok: false, reason: 'no-key' };
    const have = records.get(key)?.confirmations ?? [];
    const latest = have.reduce((max, c) => Math.max(max, c.at), 0);
    const confirmation: Confirmation = { source: read.source, lng: read.point[0], lat: read.point[1], at: Math.max(clock(), latest) };
    if (read.accuracyM !== undefined) confirmation.accuracyM = read.accuracyM;
    if (have.some((c) => idOf(c) === idOf(confirmation))) return { ok: true, trusted: (merged.get(key) as Merged).trusted, count: have.length };
    const text = formatLabel(read.place.components, 'tr');
    const record = recordOf(key, read.place.region, text, [...have, confirmation]);
    if (!(await persist(record))) return { ok: false, reason: 'store-failed' };
    return { ok: true, trusted: (merged.get(key) as Merged).trusted, count: record.confirmations.length };
  };

  const backupsOf = (key: string): string[] => [...backups].filter((b) => b === `${BACKUP}${key}` || b.startsWith(`${BACKUP}${key}#`));

  const removeAll = async (names: string[]): Promise<void> => {
    let failure: unknown = null;
    for (const name of names) {
      try {
        await config.store.remove(name);
        if (name.startsWith(BACKUP)) backups.delete(name);
        else drop(name);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure) throw failure;
  };

  return {
    layer,
    confirm: (raw) =>
      exclusive(async (): Promise<ConfirmResult> => {
        try {
          return await confirmOnce(raw);
        } catch {
          return { ok: false, reason: 'invalid-input' };
        }
      }),
    forget: (key) =>
      exclusive(async () => {
        if (key !== undefined) return removeAll([key, ...backupsOf(key)]);
        return removeAll((await config.store.readAll()).map((row) => row.key));
      }),
    exportLines: () => [...records.keys()].sort().map((key) => JSON.stringify(records.get(key))),
    importLines: (lines) =>
      exclusive(async (): Promise<ImportResult> => {
        const out: ImportResult = { added: 0, merged: 0, skipped: 0 };
        if (!Array.isArray(lines)) return out;
        for (const line of lines) {
          if (typeof line !== 'string') {
            out.skipped++;
            continue;
          }
          if (line.trim() === '') continue;
          const result = migrate(line);
          if ('skipped' in result) {
            out.skipped++;
            continue;
          }
          const { record } = result;
          const usable = record.confirmations.filter((c) => inBox(c.lng, c.lat));
          if (!validKey(record.key, record.region) || usable.length === 0) {
            out.skipped++;
            continue;
          }
          const have = records.get(record.key);
          const known = new Set((have?.confirmations ?? []).map(idOf));
          const fresh = usable.filter((c) => (known.has(idOf(c)) ? false : (known.add(idOf(c)), true)));
          if (fresh.length === 0) continue;
          const next = recordOf(record.key, record.region, have?.text ?? textOfKey(record.key), [...(have?.confirmations ?? []), ...fresh]);
          if (!(await persist(next))) {
            out.skipped++;
            continue;
          }
          if (have) out.merged++;
          else out.added++;
        }
        return out;
      }),
    stats: () => {
      const kinds = [...unreadable.values()].map((u) => u.kind);
      return { keys: records.size, confirmations: [...records.values()].reduce((n, r) => n + r.confirmations.length, 0), damaged: kinds.filter((k) => k === 'damaged').length, newer: kinds.filter((k) => k === 'newer').length };
    },
  };
}
