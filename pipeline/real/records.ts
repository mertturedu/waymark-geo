import { floorNumber, doorNumber } from '../../src/core/address/unit';
import { MAX_TRACE_POINTS, MAX_TRACE_SECONDS, type TracePoint } from '../../src/core/learned/stops';

export type CoordSource = 'pin' | 'gps' | 'delivery' | 'geocoder' | 'admin' | 'unknown';
export type Point = { lng: number; lat: number };
export type Gps = Point & { accuracyM: number };

export type DeliveryRecord = {
  v: 1;
  src: string;
  week: number;
  region: string;
  district: string;
  neighbourhood?: string;
  street?: string;
  houseNumber: string;
  block?: string;
  floor?: string;
  door?: string;
  coordSource: CoordSource;
  gps?: Gps;
  pin?: Point;
  stop?: Point;
  entrance?: Point;
  courierFloor?: string;
  trace?: TracePoint[];
};

export type Rejected = 'invalid-json' | 'unknown-field' | 'missing-field' | 'bad-value' | 'personal-data' | 'no-usable-point';

export const RECORD_FIELDS: readonly string[] = ['v', 'src', 'week', 'region', 'district', 'neighbourhood', 'street', 'houseNumber', 'block', 'floor', 'door', 'coordSource', 'gps', 'pin', 'stop', 'entrance', 'courierFloor', 'trace'];
export const MAX_TEXT = 120;
export const MAX_GPS_ACCURACY_M = 30;
const SOURCES: readonly string[] = ['pin', 'gps', 'delivery', 'geocoder', 'admin', 'unknown'];
const BOX = { west: 25.5, east: 45, south: 35.5, north: 42.5 };
const PHONE = /(?:\+?90|0)?[\s-]?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;
const EMAIL = /\S+@\S+\.\S+/;
const TCKN = /\b[1-9]\d{10}\b/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const inBox = (lng: unknown, lat: unknown): boolean => typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && lng >= BOX.west && lng <= BOX.east && lat >= BOX.south && lat <= BOX.north;
export const hasPersonalData = (text: string): boolean => PHONE.test(text) || EMAIL.test(text) || TCKN.test(text);

function point(raw: unknown): Point | null | 'bad' {
  if (raw === undefined) return null;
  if (!isObject(raw) || !inBox(raw.lng, raw.lat)) return 'bad';
  return { lng: raw.lng as number, lat: raw.lat as number };
}

export function parseRecord(line: string): { ok: true; record: DeliveryRecord } | { ok: false; reason: Rejected } {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  if (!isObject(raw)) return { ok: false, reason: 'invalid-json' };
  if (Object.keys(raw).some((k) => !RECORD_FIELDS.includes(k))) return { ok: false, reason: 'unknown-field' };
  const text = (name: string, required: boolean): string | undefined | 'bad' => {
    const value = raw[name];
    if (value === undefined || value === '') return required ? 'bad' : undefined;
    return typeof value === 'string' && value.length <= MAX_TEXT ? value.trim() : 'bad';
  };
  const district = text('district', true);
  const houseNumber = text('houseNumber', true);
  const src = text('src', true);
  if (district === 'bad' || houseNumber === 'bad' || src === 'bad' || district === undefined || houseNumber === undefined || src === undefined) return { ok: false, reason: 'missing-field' };
  const optional = ['neighbourhood', 'street', 'block', 'floor', 'door', 'courierFloor'].map((name) => [name, text(name, false)] as const);
  if (optional.some(([, v]) => v === 'bad')) return { ok: false, reason: 'bad-value' };
  const fields = Object.fromEntries(optional.filter(([, v]) => v !== undefined)) as Record<string, string>;
  if ([district, houseNumber, src, ...Object.values(fields)].some(hasPersonalData)) return { ok: false, reason: 'personal-data' };
  if (raw.v !== 1 || typeof raw.region !== 'string' || !/^[0-9]{2,3}$/.test(raw.region) || typeof raw.week !== 'number' || !Number.isInteger(raw.week) || raw.week < 0) return { ok: false, reason: 'bad-value' };
  if (typeof raw.coordSource !== 'string' || !SOURCES.includes(raw.coordSource)) return { ok: false, reason: 'bad-value' };
  const pin = point(raw.pin);
  const stop = point(raw.stop);
  const entrance = point(raw.entrance);
  if (pin === 'bad' || stop === 'bad' || entrance === 'bad') return { ok: false, reason: 'bad-value' };
  let gps: Gps | undefined;
  if (raw.gps !== undefined) {
    const p = point(raw.gps);
    const accuracy = isObject(raw.gps) ? raw.gps.accuracyM : undefined;
    if (p === 'bad' || p === null || typeof accuracy !== 'number' || !Number.isFinite(accuracy) || accuracy <= 0) return { ok: false, reason: 'bad-value' };
    gps = { ...p, accuracyM: accuracy };
  }
  if (!fields.street && !fields.neighbourhood) return { ok: false, reason: 'missing-field' };
  const trace = traceOf(raw.trace);
  if (trace === 'bad') return { ok: false, reason: 'bad-value' };
  const record: DeliveryRecord = {
    v: 1,
    src,
    week: raw.week,
    region: raw.region,
    district,
    houseNumber,
    ...fields,
    coordSource: raw.coordSource as CoordSource,
    ...(gps ? { gps } : {}),
    ...(pin ? { pin } : {}),
    ...(stop ? { stop } : {}),
    ...(entrance ? { entrance } : {}),
    ...(trace ? { trace } : {}),
  };
  return usable(record) ? { ok: true, record } : { ok: false, reason: 'no-usable-point' };
}

function traceOf(raw: unknown): TracePoint[] | null | 'bad' {
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length > MAX_TRACE_POINTS) return 'bad';
  const out: TracePoint[] = [];
  for (const item of raw) {
    if (!isObject(item) || !inBox(item.lng, item.lat)) return 'bad';
    const { accuracyM, speed, t } = item;
    if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM <= 0) return 'bad';
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > MAX_TRACE_SECONDS) return 'bad';
    if (speed !== undefined && speed !== null && (typeof speed !== 'number' || !Number.isFinite(speed))) return 'bad';
    out.push({ lng: item.lng as number, lat: item.lat as number, accuracyM, t, ...(speed === undefined ? {} : { speed }) });
  }
  return out;
}

const trustedSource = (r: DeliveryRecord): boolean => r.coordSource === 'pin' || r.coordSource === 'gps' || r.coordSource === 'delivery';

export function usable(r: DeliveryRecord): boolean {
  if (!trustedSource(r)) return false;
  return r.pin !== undefined || r.stop !== undefined || (r.trace?.length ?? 0) >= 2 || (r.gps !== undefined && r.gps.accuracyM <= MAX_GPS_ACCURACY_M);
}

const floorOf = (text: string | undefined): number | null => (text === undefined || /\+\s*$/.test(text) ? null : floorNumber(text));

export function floorDoor(r: DeliveryRecord): { floor: number; door: number } | null {
  const courier = floorOf(r.courierFloor);
  const written = floorOf(r.floor);
  if (courier !== null && written !== null && courier !== written) return null;
  const floor = courier ?? written;
  const door = doorNumber(r.door ?? null);
  return floor === null || door === null ? null : { floor, door };
}

export function readRecords(lines: Iterable<string>): { records: DeliveryRecord[]; rejected: Record<Rejected, number> } {
  const rejected: Record<Rejected, number> = { 'invalid-json': 0, 'unknown-field': 0, 'missing-field': 0, 'bad-value': 0, 'personal-data': 0, 'no-usable-point': 0 };
  const records: DeliveryRecord[] = [];
  for (const line of lines) {
    if (line.trim() === '') continue;
    const result = parseRecord(line);
    if (result.ok) records.push(result.record);
    else rejected[result.reason]++;
  }
  return { records, rejected };
}
