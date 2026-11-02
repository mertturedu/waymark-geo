import { SCHEMA_VERSION, SOURCES, type Confirmation, type ConfirmSource, type LearnedRecord } from './types';

export const CURRENT_VERSION = SCHEMA_VERSION;

export type Migrated = { record: LearnedRecord } | { skipped: 'damaged' | 'newer' };

const V0_KINDS: Record<string, ConfirmSource> = { pin: 'pin', gps: 'delivery', hand: 'manual' };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function confirmationOf(raw: unknown, source: unknown, accuracy: unknown, at: unknown): Confirmation | null {
  if (!isObject(raw) || typeof source !== 'string' || !(SOURCES as readonly string[]).includes(source)) return null;
  if (!isNumber(raw.lng) || !isNumber(raw.lat) || !isNumber(at)) return null;
  if (accuracy !== undefined && !isNumber(accuracy)) return null;
  const confirmation: Confirmation = { source: source as ConfirmSource, lng: raw.lng, lat: raw.lat, at };
  if (accuracy !== undefined) confirmation.accuracyM = accuracy as number;
  return confirmation;
}

function listOf(raw: unknown[], read: (item: unknown) => Confirmation | null): Confirmation[] | null {
  const out: Confirmation[] = [];
  for (const item of raw) {
    const confirmation = read(item);
    if (!confirmation) return null;
    out.push(confirmation);
  }
  return out.length > 0 ? out : null;
}

function fromV0(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(raw.points)) return null;
  const confirmations = listOf(raw.points, (p) => (isObject(p) ? confirmationOf(p, typeof p.kind === 'string' ? V0_KINDS[p.kind] : undefined, p.acc, p.t) : null));
  return confirmations ? { v: 1, key: raw.key, region: raw.region, text: raw.label, confirmations } : null;
}

const STEPS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown> | null> = { 0: fromV0 };

export function migrate(text: string): Migrated {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { skipped: 'damaged' };
  }
  if (!isObject(parsed) || typeof parsed.v !== 'number' || !Number.isInteger(parsed.v) || parsed.v < 0) return { skipped: 'damaged' };
  if (parsed.v > CURRENT_VERSION) return { skipped: 'newer' };
  let current: Record<string, unknown> | null = parsed;
  while (current && (current.v as number) < CURRENT_VERSION) current = (STEPS[current.v as number] as (raw: Record<string, unknown>) => Record<string, unknown> | null)(current);
  if (!current || typeof current.key !== 'string' || typeof current.region !== 'string' || typeof current.text !== 'string' || !Array.isArray(current.confirmations)) return { skipped: 'damaged' };
  const confirmations = listOf(current.confirmations, (c) => (isObject(c) ? confirmationOf(c, c.source, c.accuracyM, c.at) : null));
  if (!confirmations) return { skipped: 'damaged' };
  return { record: { v: CURRENT_VERSION, key: current.key, region: current.region, text: current.text, confirmations } };
}
