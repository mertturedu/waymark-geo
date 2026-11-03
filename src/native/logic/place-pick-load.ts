import type { LngLat } from '../../core/geo/cells';
import type { Place } from '../../core/address/types';
import { GLYPH_TABLE, KIND_GLYPH } from '../map/poi-glyphs';
import { pickPlace, PICK_RADIUS_PX, type Pickable } from './place-pick';
import { placeCard, type CardFeature, type PlaceCardData } from './place-card';

export type MapFeature = { properties?: Record<string, unknown> | null; geometry: { type: string; coordinates?: unknown } };

export const TIER_OF_GROUP: Record<string, number> = { health: 1, pharmacy: 2, safety: 3, money: 3, fuel: 3, worship: 2, lodging: 3, market: 3, public: 3, transit: 2 };

export function featureOf(feature: MapFeature): CardFeature | null {
  if (feature.geometry.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return null;
  const [lng, lat] = feature.geometry.coordinates as number[];
  if (typeof lng !== 'number' || typeof lat !== 'number' || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const props = feature.properties ?? {};
  const name = typeof props['name:tr'] === 'string' && props['name:tr'] !== '' ? props['name:tr'] : typeof props.name === 'string' ? props.name : null;
  const kindGroup = typeof props.kind === 'string' ? (GLYPH_TABLE.find((row) => row.name === KIND_GLYPH[props.kind as string])?.group ?? null) : null;
  const group = typeof props.grp === 'string' ? props.grp : typeof props.g === 'string' ? props.g : kindGroup;
  return { name, group, coordinate: [lng, lat] };
}

export async function loadPlaceCard(
  deps: { project(point: LngLat): Promise<[number, number]> | [number, number]; reverse(point: LngLat): Promise<Place | null>; lang: string; radiusPx?: number },
  features: readonly MapFeature[],
  tap: { x: number; y: number },
): Promise<PlaceCardData | null> {
  const candidates: Pickable<CardFeature>[] = [];
  for (const raw of features) {
    const feature = featureOf(raw);
    if (!feature) continue;
    const [x, y] = await deps.project(feature.coordinate);
    candidates.push({ x, y, tier: TIER_OF_GROUP[feature.group ?? ''] ?? 4, item: feature });
  }
  const chosen = pickPlace(candidates, tap, deps.radiusPx ?? PICK_RADIUS_PX);
  if (!chosen) return null;
  const address = await deps.reverse(chosen.coordinate).catch(() => null);
  return placeCard(chosen, address, deps.lang);
}
