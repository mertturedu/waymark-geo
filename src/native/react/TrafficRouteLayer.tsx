import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import type { LngLat } from '../../core/geo/cells';
import type { BandSpan } from '../../core/route/traffic';
import { trafficRouteFeatures } from '../logic/traffic-route';
import { TRAFFIC_COLOURS } from '../map/style';

export const ROUTE_INK = { light: '#111111', dark: '#C9CFDB' };
const ROUTE_CASING = { light: '#FFFFFF', dark: '#12151C' };

type Props = { id?: string; geometry: ReadonlyArray<LngLat>; spans?: BandSpan[]; theme?: 'light' | 'dark'; width?: number; arrows?: boolean };

export function TrafficRouteLayer({ id = 'geo-route', geometry, spans, theme = 'light', width = 7, arrows = true }: Props) {
  const data = useMemo(() => trafficRouteFeatures(geometry, spans), [geometry, spans]);
  const colour = ['match', ['get', 'band'], 'busy', TRAFFIC_COLOURS.busy, 'heavy', TRAFFIC_COLOURS.heavy, 'jam', TRAFFIC_COLOURS.jam, ROUTE_INK[theme]];
  const layout = { 'line-cap': 'butt', 'line-join': 'round' } as const;
  return (
    <GeoJSONSource id={id} data={data as never}>
      <Layer id={`${id}-casing`} type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ROUTE_CASING[theme], 'line-width': width + 3 }} />
      <Layer id={`${id}-line`} type="line" layout={layout} paint={{ 'line-color': colour as never, 'line-width': width }} />
      {arrows ? (
        <Layer
          id={`${id}-arrows`}
          type="symbol"
          minzoom={13}
          layout={{ 'symbol-placement': 'line', 'symbol-spacing': 80, 'text-field': '>', 'text-font': ['NotoSansMedium'], 'text-size': 15, 'text-keep-upright': false, 'text-allow-overlap': true, 'text-ignore-placement': true }}
          paint={{ 'text-color': '#FFFFFF' }}
        />
      ) : null}
    </GeoJSONSource>
  );
}
