import type { LngLat } from '../../core/geo/cells';
import { t, tryMessage, type MessageKey } from '../../core/i18n/messages';
import type { Place } from '../../core/address/types';

export type CardFeature = { name: string | null; group: string | null; coordinate: LngLat };

export type PlaceCardData = {
  title: string;
  category: string | null;
  lines: string[];
  copyText: string | null;
  coordinate: LngLat;
};

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
};

export function addressLines(place: Place | null): string[] {
  if (!place) return [];
  const c = place.components;
  const street = [clean(c.street), clean(c.houseNumber)].filter((part): part is string => part !== null).join(' ');
  const area = [clean(c.neighbourhood), clean(c.district), clean(c.province)].filter((part): part is string => part !== null).join(', ');
  return [street, area].filter((line) => line !== '');
}

export function placeCard(feature: CardFeature, address: Place | null, lang: string): PlaceCardData {
  const lines = addressLines(address);
  const key = feature.group ? (`group.${feature.group}` as MessageKey) : null;
  const postcode = clean(address?.components.postcode);
  return {
    title: clean(feature.name) ?? (address?.components.street ?? t(lang, 'card.noAddress')),
    category: key && tryMessage(lang, key) !== undefined ? t(lang, key) : null,
    lines: postcode ? [...lines, postcode] : lines,
    copyText: lines.length > 0 ? [clean(feature.name), ...lines].filter((part): part is string => part !== null).join(', ') : null,
    coordinate: feature.coordinate,
  };
}

export function hereText(place: Place | null, lang: string): string | null {
  if (!place) return null;
  const c = place.components;
  const street = [clean(c.street), clean(c.houseNumber)].filter((part): part is string => part !== null).join(' ');
  const label = [clean(c.neighbourhood), street === '' ? null : street].filter((part): part is string => part !== null).join(', ');
  return label === '' ? null : t(lang, 'here.near', { label });
}
