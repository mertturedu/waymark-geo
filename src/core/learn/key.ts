import type { Components, LayerKey, LayerScope, Place } from '../address/types';
import { nameKey } from '../text/fold';
import { houseNumberKey } from '../text/number';
import { streetKey } from '../text/street';

export const streetPart = (key: string, kind: string | null): string => (key === '' ? '' : kind ? `${key}~${kind}` : key);

const clean = (part: string): string => part.replace(/\|/g, ' ');

export function composeKey(parts: LayerKey): string {
  return [parts.region, parts.district, parts.neighbourhood, parts.street, parts.houseNumber].map(clean).join('|');
}

function streetOf(name: string): string {
  const k = streetKey(name);
  return streetPart(k.key, k.kind);
}

export function layerKeyOf(region: string, c: Components): LayerKey | null {
  if (!region || !c.district || !c.houseNumber) return null;
  const number = houseNumberKey(c.houseNumber);
  if (!number) return null;
  if (!c.street && !c.neighbourhood) return null;
  return {
    region,
    district: nameKey(c.district),
    neighbourhood: c.neighbourhood ? nameKey(c.neighbourhood) : '',
    street: c.street ? streetOf(c.street) : '',
    houseNumber: number.key,
  };
}

export function learnKey(place: Place): string | null {
  const key = layerKeyOf(place.region, place.components);
  return key ? composeKey(key) : null;
}

export function scopeOfKey(key: string): { scope: string; int: number } | null {
  const parts = key.split('|');
  const number = houseNumberKey(parts[4] ?? '');
  if (parts.length !== 5 || parts[3] === '' || number === null || number.int === null) return null;
  return { scope: parts.slice(0, 4).join('|'), int: number.int };
}

export const scopeKey = (scope: LayerScope): string => composeKey({ ...scope, houseNumber: '' }).slice(0, -1);

const MAX_PART = 120;
const MAX_KEY = 400;

export function validKey(key: string, region: string): boolean {
  const parts = key.split('|');
  if (parts.length !== 5 || parts[0] !== region || !/^[0-9]{2,3}$/.test(region) || key.length > MAX_KEY) return false;
  if (parts.some((part) => part.length > MAX_PART)) return false;
  return parts[1] !== '' && parts[4] !== '' && (parts[2] !== '' || parts[3] !== '');
}

export const textOfKey = (key: string): string => key.split('|').filter((part) => part !== '').join(' ');
