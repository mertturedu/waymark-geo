import type { Borders } from './borders';

export type Outline = {
  type: 'Feature';
  id: number;
  properties: { plate: string };
  geometry: { type: 'MultiPolygon'; coordinates: number[][][][] };
};

export type OutlineCollection = { type: 'FeatureCollection'; features: Outline[] };

const closed = (ring: number[][]): number[][] => {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first && last && (first[0] !== last[0] || first[1] !== last[1]) ? [...ring, first] : ring;
};

export function regionOutlines(borders: Pick<Borders, 'provincePolygons'>, plates: string[]): OutlineCollection {
  const features: Outline[] = [];
  for (const plate of plates) {
    const polygons = borders.provincePolygons(plate);
    if (polygons.length === 0) continue;
    features.push({
      type: 'Feature',
      id: Number(plate),
      properties: { plate },
      geometry: { type: 'MultiPolygon', coordinates: polygons.map((polygon) => polygon.map((ring) => closed(ring.map(([x, y]) => [x, y])))) },
    });
  }
  return { type: 'FeatureCollection', features };
}
