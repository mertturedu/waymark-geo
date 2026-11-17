import { NativeUserLocation } from '@maplibre/maplibre-react-native';
import type { LocateMode } from '../logic/locate';

export function GeoUserLocation({ visible, mode }: { visible: boolean; mode: LocateMode }) {
  if (!visible) return null;
  return <NativeUserLocation mode={mode === 'heading' ? 'heading' : 'default'} />;
}
