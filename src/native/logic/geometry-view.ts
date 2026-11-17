import type { Place, PlaceGeometry } from '../../core/address/types';
import type { LngLat } from '../../core/geo/cells';
import { distanceM } from '../../core/geo/distance';

export type GeometryFeature = { type: 'Feature'; properties: Record<string, string | number>; geometry: { type: 'LineString'; coordinates: LngLat[] } | { type: 'Polygon'; coordinates: LngLat[][] } | { type: 'Point'; coordinates: LngLat } };
export type GeometryCollection = { type: 'FeatureCollection'; features: GeometryFeature[] };

export type GeometryView = { lines: GeometryCollection; areas: GeometryCollection; label: GeometryCollection };

const collection = (features: GeometryFeature[]): GeometryCollection => ({ type: 'FeatureCollection', features });

export const numbersText = (range: [number, number] | null): string => (range ? (range[0] === range[1] ? `No ${range[0]}` : `No ${range[0]}-${range[1]}`) : '');

function middleOf(lines: readonly LngLat[][]): LngLat | null {
  let best: LngLat[] | null = null;
  let bestLength = -1;
  for (const line of lines) {
    let length = 0;
    for (let i = 1; i < line.length; i++) length += distanceM(line[i - 1] as LngLat, line[i] as LngLat);
    if (length > bestLength) {
      bestLength = length;
      best = line;
    }
  }
  return best ? (best[Math.floor(best.length / 2)] as LngLat) : null;
}

export function geometryView(geometry: PlaceGeometry | null | undefined, name = ''): GeometryView {
  const empty: GeometryView = { lines: collection([]), areas: collection([]), label: collection([]) };
  if (!geometry) return empty;
  if (geometry.kind === 'area') {
    return { ...empty, areas: collection(geometry.polygons.map((rings) => ({ type: 'Feature' as const, properties: { level: geometry.level }, geometry: { type: 'Polygon' as const, coordinates: rings } }))) };
  }
  const local = new Set(geometry.local);
  const lines = geometry.lines.map((coordinates, i) => ({ type: 'Feature' as const, properties: { local: local.has(i) ? 1 : 0 }, geometry: { type: 'LineString' as const, coordinates } }));
  const marked = geometry.local.flatMap((i) => (geometry.lines[i] ? [geometry.lines[i] as LngLat[]] : []));
  const middle = middleOf(marked.length > 0 ? marked : geometry.lines);
  const text = [name, numbersText(geometry.numbers)].filter((part) => part !== '').join(' · ');
  const label = middle && text !== '' ? [{ type: 'Feature' as const, properties: { text }, geometry: { type: 'Point' as const, coordinates: middle } }] : [];
  return { ...empty, lines: collection(lines), label: collection(label) };
}

export const placeName = (place: Pick<Place, 'components'>): string => place.components.street ?? place.components.neighbourhood ?? place.components.district ?? '';
