import { distanceM } from '../geo/distance';
import { nameKey } from '../text/fold';
import { houseNumberKey } from '../text/number';
import { streetKey } from '../text/street';
import type { Scored } from './resolve';

export const DIRECTORY_FACTOR = 0.96;
const POI_NEAR_M = 150;
const SAME_DOOR_M = 150;
const KNOWN_STREET: ReadonlySet<string> = new Set(['address', 'interpolated', 'street']);

type Spot = { district: string; street: string; kind: string | null; hood: string | null; number: string; at: Scored['place']['coordinate'] };

function spotOf(s: Scored): Spot {
  const c = s.place.components;
  const street = streetKey(c.street ?? '');
  return { district: c.district ?? '', street: street.key, kind: street.kind, hood: c.neighbourhood ? nameKey(c.neighbourhood) : null, number: houseNumberKey(c.houseNumber ?? '')?.key ?? '', at: s.place.coordinate };
}

const sameStreet = (a: Spot, b: Spot): boolean => a.district === b.district && a.street === b.street && (a.kind === null || b.kind === null || a.kind === b.kind);
const sameHood = (a: Spot, b: Spot): boolean => a.hood === null || b.hood === null || a.hood === b.hood;
const sameDoor = (a: Spot, b: Spot): boolean => sameStreet(a, b) && a.number === b.number && (sameHood(a, b) || distanceM(a.at, b.at) <= SAME_DOOR_M);

const round = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;

function relabel(plate: string, s: Scored): Scored {
  const score = s.score * DIRECTORY_FACTOR;
  const own = `${plate}:`;
  return {
    ...s,
    score,
    place: {
      ...s.place,
      id: s.place.id.startsWith(own) ? `${plate}+:${s.place.id.slice(own.length)}` : s.place.id,
      source: s.place.source === 'osm' ? 'overture' : s.place.source,
      precision: s.place.precision === 'address' ? 'interpolated' : s.place.precision,
      approximate: s.place.precision === 'address' ? true : s.place.approximate,
      confidence: round(score),
    },
  };
}

export function mergeDirectory(plate: string, primary: Scored[], extra: Scored[]): Scored[] {
  const doors = primary.filter((s) => s.place.precision === 'address').map(spotOf);
  const guesses = primary.filter((s) => s.place.precision === 'interpolated').map(spotOf);
  const streets = primary.filter((s) => KNOWN_STREET.has(s.place.precision)).map(spotOf);
  const pois = primary.filter((s) => s.place.precision === 'poi');
  const kept = extra.filter((s) => {
    switch (s.place.precision) {
      case 'address':
        return !doors.some((d) => sameDoor(d, spotOf(s)));
      case 'interpolated': {
        const spot = spotOf(s);
        return !doors.some((d) => sameDoor(d, spot)) && !(s.place.source === 'interpolated' && guesses.some((g) => sameDoor(g, spot)));
      }
      case 'street': {
        const spot = spotOf(s);
        return !streets.some((t) => sameStreet(t, spot) && sameHood(t, spot));
      }
      case 'poi': {
        const name = nameKey(s.place.components.poiName ?? '');
        return !pois.some((p) => nameKey(p.place.components.poiName ?? '') === name && distanceM(p.place.coordinate, s.place.coordinate) <= POI_NEAR_M);
      }
      default:
        return false;
    }
  });
  return [...primary, ...kept.map((s) => relabel(plate, s))];
}
