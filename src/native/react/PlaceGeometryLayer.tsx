import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import type { Place } from '../../core/address/types';
import { geometryView, placeName } from '../logic/geometry-view';

const COLORS = { light: { line: '#ff5b04', casing: '#ffffff', local: '#c43c00', fill: '#ff5b04', text: '#14171f', halo: '#ffffff' }, dark: { line: '#ff8a4c', casing: '#1b1b1f', local: '#ffb184', fill: '#ff8a4c', text: '#eef1f7', halo: '#1b1b1f' } };

export function PlaceGeometryLayer({ place, theme = 'light' }: { place: Place | null; theme?: 'light' | 'dark' }) {
  const view = useMemo(() => geometryView(place?.geometry, place ? placeName(place) : ''), [place]);
  const colors = COLORS[theme];
  if (!place?.geometry) return null;
  return (
    <>
      <GeoJSONSource id="geo-shape-areas" data={view.areas as never}>
        <Layer id="geo-shape-fill" type="fill" paint={{ 'fill-color': colors.fill, 'fill-opacity': 0.12 }} />
        <Layer id="geo-shape-outline" type="line" layout={{ 'line-join': 'round' }} paint={{ 'line-color': colors.line, 'line-width': 2.5, 'line-dasharray': [2, 1.5] }} />
      </GeoJSONSource>
      <GeoJSONSource id="geo-shape-lines" data={view.lines as never}>
        <Layer id="geo-shape-casing" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': colors.casing, 'line-width': 8, 'line-opacity': 0.9 }} />
        <Layer id="geo-shape-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ['case', ['==', ['get', 'local'], 1], colors.local, colors.line], 'line-width': ['case', ['==', ['get', 'local'], 1], 5, 4] }} />
      </GeoJSONSource>
      <GeoJSONSource id="geo-shape-label" data={view.label as never}>
        <Layer id="geo-shape-text" type="symbol" layout={{ 'text-field': ['get', 'text'], 'text-size': 13, 'text-font': ['NotoSansMedium'], 'text-allow-overlap': true, 'text-offset': [0, -1.2] }} paint={{ 'text-color': colors.text, 'text-halo-color': colors.halo, 'text-halo-width': 1.6 }} />
      </GeoJSONSource>
    </>
  );
}
