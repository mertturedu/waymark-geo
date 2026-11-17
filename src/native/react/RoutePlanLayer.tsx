import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import type { PlanResult } from '../../core/plan/types';
import { planFeatures, type PlanState } from '../logic/plan-view';

const COLORS = { light: { line: '#2b6cff', done: '#9aa5b8', mark: '#ffffff', text: '#14171f' }, dark: { line: '#6aa0ff', done: '#5b6577', mark: '#2a2a30', text: '#eef1f7' } };

export function RoutePlanLayer({ state, result, nextLeg = 0, theme = 'light' }: { state: PlanState; result: PlanResult | null; nextLeg?: number; theme?: 'light' | 'dark' }) {
  const { legs, stops } = useMemo(() => planFeatures(state, result, nextLeg), [state, result, nextLeg]);
  const colors = COLORS[theme];
  return (
    <>
      <GeoJSONSource id="geo-plan-legs" data={legs as never}>
        <Layer id="geo-plan-line" type="line" layout={{ 'line-cap': 'round', 'line-join': 'round' }} paint={{ 'line-color': ['case', ['==', ['get', 'done'], 1], colors.done, colors.line], 'line-width': ['case', ['==', ['get', 'next'], 1], 6, 3.5], 'line-opacity': 0.9 }} />
      </GeoJSONSource>
      <GeoJSONSource id="geo-plan-stops" data={stops as never}>
        <Layer id="geo-plan-dot" type="circle" paint={{ 'circle-radius': 11, 'circle-color': colors.mark, 'circle-stroke-width': ['case', ['==', ['get', 'pinned'], 1], 3, 2], 'circle-stroke-color': ['case', ['==', ['get', 'visited'], 1], colors.done, colors.line], 'circle-opacity': ['case', ['==', ['get', 'visited'], 1], 0.55, 1] }} />
        <Layer id="geo-plan-number" type="symbol" layout={{ 'text-field': ['get', 'label'], 'text-size': 12, 'text-font': ['NotoSansMedium'], 'text-allow-overlap': true, 'text-ignore-placement': true }} paint={{ 'text-color': colors.text }} />
      </GeoJSONSource>
    </>
  );
}
