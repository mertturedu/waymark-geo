import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import { hoodFeatures, hoodLabelLayer, type MapFont } from '../map/style';
import { useHoodLabels } from './hooks';

export function GeoHoodLabels({ theme = 'light', language = 'tr', font = 'noto' }: { theme?: 'light' | 'dark'; language?: string; font?: MapFont }) {
  const hoods = useHoodLabels(language);
  const data = useMemo(() => hoodFeatures(hoods), [hoods]);
  const layer = useMemo(() => hoodLabelLayer(theme, font), [theme, font]);
  if (data.features.length === 0) return null;
  return (
    <GeoJSONSource id="geo-hoods" data={data as never}>
      <Layer id={layer.id} type="symbol" minzoom={layer.minzoom} layout={layer.layout as never} paint={layer.paint as never} />
    </GeoJSONSource>
  );
}
