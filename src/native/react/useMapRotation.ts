import type { CameraRef } from '@maplibre/maplibre-react-native';
import { useCallback, useRef, useState, type RefObject } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { bearingChanged, northTarget, type RotationView } from '../logic/rotation';

export type RotationEvent = NativeSyntheticEvent<{ center: [number, number]; zoom: number; bearing?: number; pitch?: number }>;

export type RotationOptions = {
  cameraRef: RefObject<CameraRef | null>;
  enabled?: boolean;
  onRegionDidChange?: (event: RotationEvent) => void;
};

export type MapRotation = {
  bearing: number;
  gestures: { touchRotate: boolean };
  onRegionDidChange: (event: RotationEvent) => void;
  resetNorth: () => void;
  compass: { bearing: number; onPress: () => void };
};

export function useMapRotation({ cameraRef, enabled = true, onRegionDidChange }: RotationOptions): MapRotation {
  const [bearing, setBearing] = useState(0);
  const shown = useRef(0);
  const view = useRef<RotationView | null>(null);

  const changed = useCallback(
    (event: RotationEvent) => {
      const { center, bearing: next = 0, pitch } = event.nativeEvent;
      view.current = { center: [center[0], center[1]], ...(pitch === undefined ? {} : { pitch }) };
      if (bearingChanged(shown.current, next)) {
        shown.current = next;
        setBearing(next);
      }
      onRegionDidChange?.(event);
    },
    [onRegionDidChange],
  );

  const resetNorth = useCallback(() => {
    if (view.current) cameraRef.current?.easeTo(northTarget(view.current));
  }, [cameraRef]);

  return { bearing, gestures: { touchRotate: enabled }, onRegionDidChange: changed, resetNorth, compass: { bearing, onPress: resetNorth } };
}
