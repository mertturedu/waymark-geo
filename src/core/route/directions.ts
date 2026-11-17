import type { LngLat } from '../geo/cells';
import { pointAlong } from '../geo/distance';
import { t, type MessageKey } from '../i18n/messages';
import { buildManeuvers, type Maneuver, type ManeuverKind } from './maneuvers';

export type DirectionStep = Maneuver & { action: string; text: string; distanceText: string };

const COMMA_LANGS = ['tr', 'de', 'ru', 'el'];
export const STREET_PROBE_M = 15;

export function formatDistance(meters: number, lang: string): string {
  const m = Math.max(0, meters);
  if (m < 1000) {
    const rounded = m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50;
    if (rounded < 1000) return `${rounded} ${t(lang, 'unit.m')}`;
  }
  const km = Math.round(m / 100) / 10;
  const text = Number.isInteger(km) ? String(km) : km.toFixed(1);
  return `${COMMA_LANGS.includes(lang.slice(0, 2)) ? text.replace('.', ',') : text} ${t(lang, 'unit.km')}`;
}

const KEYS: Record<Exclude<ManeuverKind, 'roundabout'>, MessageKey> = {
  start: 'turn.start',
  arrive: 'turn.arrive',
  straight: 'turn.straight',
  'slight-left': 'turn.slight-left',
  left: 'turn.left',
  'sharp-left': 'turn.sharp-left',
  'slight-right': 'turn.slight-right',
  right: 'turn.right',
  'sharp-right': 'turn.sharp-right',
  uturn: 'turn.uturn',
};

export function describeStep(step: Maneuver, lang: string): DirectionStep {
  const base = step.kind === 'roundabout' ? t(lang, 'turn.roundabout', { n: step.exit ?? 1 }) : t(lang, KEYS[step.kind]);
  const action = step.street && step.kind !== 'arrive' ? t(lang, 'turn.onto', { action: base, street: step.street }) : base;
  const distanceText = formatDistance(step.legM, lang);
  const ahead = step.kind !== 'start' && step.kind !== 'arrive';
  return { ...step, action, distanceText, text: ahead ? t(lang, 'turn.in', { dist: distanceText, action }) : action };
}

export type StreetAt = (point: LngLat) => Promise<string | null>;

export async function directionsOf(geometry: readonly LngLat[], lang: string, streetAt?: StreetAt): Promise<DirectionStep[]> {
  const steps = buildManeuvers(geometry);
  if (streetAt) {
    const line = [...geometry];
    for (const step of steps) {
      if (step.kind === 'arrive') continue;
      const street = await streetAt(pointAlong(line, step.atM + STREET_PROBE_M)).catch(() => null);
      if (street) step.street = street;
    }
  }
  return steps.map((step) => describeStep(step, lang));
}
