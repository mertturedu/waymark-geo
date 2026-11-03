import { LocationManager, type GeolocationPosition } from '@maplibre/maplibre-react-native';
import { ageMs, timestampMs } from '../logic/location-region';

export const FIX_MS = 5000;
export const MAX_FIX_AGE_MS = 120_000;
export const STALE_FIX_AGE_MS = 1_800_000;

export const firstFix = (timeoutMs: number = FIX_MS, maxAgeMs: number = MAX_FIX_AGE_MS, staleAgeMs: number = STALE_FIX_AGE_MS): Promise<GeolocationPosition | undefined> =>
  new Promise((resolve) => {
    let done = false;
    let stale: GeolocationPosition | undefined;
    const finish = (position: GeolocationPosition | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      LocationManager.removeListener(listen);
      resolve(position);
    };
    const listen = (position: GeolocationPosition) => {
      const age = ageMs(position.timestamp);
      if (age <= maxAgeMs) finish(position);
      else if (age <= staleAgeMs && (!stale || timestampMs(position.timestamp) > timestampMs(stale.timestamp))) stale = position;
    };
    const timer = setTimeout(() => finish(stale), timeoutMs);
    LocationManager.addListener(listen);
  });
