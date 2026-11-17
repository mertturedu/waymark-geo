import type { LngLat } from '../../core/geo/cells';
import { distanceM } from '../../core/geo/distance';
import type { BandSpan } from '../../core/route/traffic';
import type { TrafficBand } from '../../core/traffic/model';

export type RouteFeature = { type: 'Feature'; properties: { band: TrafficBand }; geometry: { type: 'LineString'; coordinates: LngLat[] } };
export type RouteCollection = { type: 'FeatureCollection'; features: RouteFeature[] };

const EMPTY: RouteCollection = { type: 'FeatureCollection', features: [] };

function between(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function sliceShare(line: ReadonlyArray<LngLat>, from: number, to: number): LngLat[] {
  if (line.length < 2 || to <= from) return [];
  const cumulative: number[] = [0];
  for (let i = 1; i < line.length; i++) cumulative.push((cumulative[i - 1] as number) + distanceM(line[i - 1] as LngLat, line[i] as LngLat));
  const total = cumulative[cumulative.length - 1] as number;
  if (total === 0) return [];
  const start = from * total;
  const end = to * total;
  const out: LngLat[] = [];
  for (let i = 1; i < line.length; i++) {
    const a = cumulative[i - 1] as number;
    const b = cumulative[i] as number;
    if (b < start || a > end) continue;
    const span = b - a;
    const enter = a >= start ? 0 : (start - a) / span;
    const leave = b <= end ? 1 : (end - a) / span;
    const first = between(line[i - 1] as LngLat, line[i] as LngLat, enter);
    if (out.length === 0) out.push(first);
    out.push(between(line[i - 1] as LngLat, line[i] as LngLat, leave));
  }
  return out;
}

export function trafficRouteFeatures(geometry: ReadonlyArray<LngLat>, spans: ReadonlyArray<BandSpan> | undefined): RouteCollection {
  if (geometry.length < 2) return EMPTY;
  const parts = spans && spans.length > 0 ? spans : [{ band: 'smooth' as TrafficBand, from: 0, to: 1 }];
  const features: RouteFeature[] = [];
  for (const span of parts) {
    const coordinates = sliceShare(geometry, span.from, span.to);
    if (coordinates.length >= 2) features.push({ type: 'Feature', properties: { band: span.band }, geometry: { type: 'LineString', coordinates } });
  }
  return { type: 'FeatureCollection', features };
}
