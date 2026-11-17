import { LocationManager, type CameraRef, type TrackUserLocationChangeEvent } from '@maplibre/maplibre-react-native';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Linking, type NativeSyntheticEvent } from 'react-native';
import { firstFix, MAX_FIX_AGE_MS } from '../platform/location';
import { ageMs } from '../logic/location-region';
import { LOCATE_ZOOM, modeOfTracking, needsZoom, nextMode, trackingOf, zoomFor, type LocateMode, type LocatePermission, type Tracking } from '../logic/locate';

export type LocateOptions = {
  cameraRef: RefObject<CameraRef | null>;
  zoom?: number;
  getZoom?: () => number | undefined;
  headingMode?: boolean;
  granted?: boolean;
  onDenied?: () => void;
  onUnavailable?: () => void;
};

export type LocateControls = {
  mode: LocateMode;
  permission: LocatePermission;
  busy: boolean;
  press: () => Promise<void>;
  stop: () => void;
  openSettings: () => void;
  camera: { trackUserLocation: Tracking | undefined; onTrackUserLocationChange: (event: NativeSyntheticEvent<TrackUserLocationChangeEvent>) => void };
  puck: { visible: boolean; mode: LocateMode };
};

const EASE_MS = 600;
const FRESH_MS = 15000;

export function useLocateMe({ cameraRef, zoom = LOCATE_ZOOM, getZoom, headingMode = true, granted, onDenied, onUnavailable }: LocateOptions): LocateControls {
  const [mode, setMode] = useState<LocateMode>('off');
  const [permission, setPermission] = useState<LocatePermission>(granted ? 'granted' : 'unknown');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const working = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const wasGranted = useRef(granted === true);
  useEffect(() => {
    if (granted) setPermission('granted');
    else if (granted === false && wasGranted.current) {
      setPermission('unknown');
      setMode('off');
    }
    wasGranted.current = granted === true;
  }, [granted]);

  const press = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      if (permission !== 'granted') {
        const ok = await LocationManager.requestPermissions();
        if (!alive.current) return;
        setPermission(ok ? 'granted' : 'denied');
        if (!ok) {
          onDenied?.();
          return;
        }
      }
      if (mode !== 'off') {
        setMode(nextMode(mode, headingMode));
        return;
      }
      const cached = await LocationManager.getCurrentPosition();
      const position = cached && ageMs(cached.timestamp) <= MAX_FIX_AGE_MS ? cached : await firstFix();
      if (!alive.current) return;
      if (!position) {
        onUnavailable?.();
        return;
      }
      const current = getZoom?.();
      if (needsZoom(current, zoom)) {
        const target = zoomFor(current, zoom);
        if (ageMs(position.timestamp) < FRESH_MS) cameraRef.current?.easeTo({ center: [position.coords.longitude, position.coords.latitude], zoom: target, duration: EASE_MS });
        else cameraRef.current?.zoomTo(target, { duration: EASE_MS });
        await new Promise((resolve) => setTimeout(resolve, EASE_MS + 40));
        if (!alive.current) return;
      }
      setMode('follow');
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  }, [permission, mode, headingMode, zoom, getZoom, cameraRef, onDenied, onUnavailable]);

  const stop = useCallback(() => setMode('off'), []);
  const openSettings = useCallback(() => void Linking.openSettings().catch(() => undefined), []);

  const onTrackUserLocationChange = useCallback((event: NativeSyntheticEvent<TrackUserLocationChangeEvent>) => {
    setMode(modeOfTracking(event.nativeEvent.trackUserLocation));
  }, []);

  return {
    mode,
    permission,
    busy,
    press,
    stop,
    openSettings,
    camera: { trackUserLocation: trackingOf(mode), onTrackUserLocationChange },
    puck: { visible: permission === 'granted', mode },
  };
}
