import { localTime, type DayKind } from './model';

export type ObservedProfile = { precision: number; levels: number; cells: Record<string, string> };

const ALPHABET = '0123456789bcdefghjkmnpqrstuvwxyz';
const DAYS: DayKind[] = ['weekday', 'saturday', 'sunday'];
const HOURS = 24;
const MISSING = '-';

export function geohash(lat: number, lng: number, precision: number): string {
  let latLow = -90;
  let latHigh = 90;
  let lngLow = -180;
  let lngHigh = 180;
  let even = true;
  let bits = 0;
  let value = 0;
  let out = '';
  while (out.length < precision) {
    if (even) {
      const mid = (lngLow + lngHigh) / 2;
      value = lng >= mid ? (lngLow = mid, (value << 1) | 1) : (lngHigh = mid, value << 1);
    } else {
      const mid = (latLow + latHigh) / 2;
      value = lat >= mid ? (latLow = mid, (value << 1) | 1) : (latHigh = mid, value << 1);
    }
    even = !even;
    bits += 1;
    if (bits === 5) {
      out += ALPHABET[value];
      bits = 0;
      value = 0;
    }
  }
  return out;
}

export function encodeSlowdowns(values: ReadonlyArray<number | null>, levels: number): string {
  return values.map((v) => (v === null ? MISSING : Math.round(Math.min(1, Math.max(0, v)) * levels).toString(36))).join('');
}

function slot(profile: ObservedProfile, text: string, day: number, hour: number): number | null {
  const ch = text[day * HOURS + hour];
  return ch === undefined || ch === MISSING ? null : parseInt(ch, 36) / profile.levels;
}

export function observedSlowdown(profile: ObservedProfile, lat: number, lng: number, at: number): number | null {
  const text = profile.cells[geohash(lat, lng, profile.precision)];
  if (text === undefined) return null;
  const { hour, day } = localTime(at);
  const d = DAYS.indexOf(day);
  const low = Math.floor(hour);
  const share = hour - low;
  const a = slot(profile, text, d, low % HOURS);
  const b = slot(profile, text, d, (low + 1) % HOURS);
  if (a === null) return b;
  return b === null ? a : a * (1 - share) + b * share;
}

export function observedByCell(profile: ObservedProfile, at: number): Record<string, number> {
  const { hour, day } = localTime(at);
  const d = DAYS.indexOf(day);
  const low = Math.floor(hour);
  const share = hour - low;
  const out: Record<string, number> = {};
  for (const [cell, text] of Object.entries(profile.cells)) {
    const a = slot(profile, text, d, low % HOURS);
    const b = slot(profile, text, d, (low + 1) % HOURS);
    const value = a === null ? b : b === null ? a : a * (1 - share) + b * share;
    if (value !== null) out[cell] = value;
  }
  return out;
}
