import type { DeviceTest } from '../../device-test/types';
import type { LngLat } from '../map-tour/driver';
import { REGION_FEATURES, test, withTour } from './map-tour';

export const SHOT_SPOTS: { id: string; at: LngLat }[] = [
  { id: 'kadikoy', at: [29.0278, 40.9925] },
  { id: 'besiktas', at: [29.0097, 41.0422] },
  { id: 'eminonu', at: [28.9752, 41.0158] },
  { id: 'uskudar', at: [29.0153, 41.0226] },
  { id: 'atasehir', at: [29.1236, 40.9923] },
];

export const SHOT_ZOOM = 15;
const SETTLE_MS = 2500;
const HOLD_MS = 4000;

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const sdkShotTour: DeviceTest = test('sdk.shot-tour', 'Ekran görüntüsü turu: 5 noktada harita durur, sunucuya işaret gider (bilgi)', (ctx) =>
  withTour(ctx, async (tour) => {
    for (const spot of SHOT_SPOTS) {
      tour.say('');
      await tour.go({ center: spot.at, zoom: SHOT_ZOOM }, 'jump');
      await tour.until(['roads_'], REGION_FEATURES, 12000);
      await pause(SETTLE_MS);
      await fetch(`${ctx.packServerUrl}/mark/${spot.id}-z${SHOT_ZOOM + 1}`).catch(() => undefined);
      await pause(HOLD_MS);
    }
    return { outcome: 'info', note: `${SHOT_SPOTS.length} nokta, Apple z${SHOT_ZOOM + 1} eşdeğeri (bizim z${SHOT_ZOOM})` };
  }),
);

const TRAFFIC_RUSH = Date.UTC(2026, 10, 9, 5, 30);
const TRAFFIC_VIEWS: { zoom: number; at: LngLat }[] = [
  { zoom: 8, at: [29.0, 40.95] },
  { zoom: 10, at: [29.0, 41.02] },
  { zoom: 12, at: [29.0, 41.02] },
  { zoom: 14, at: [29.0097, 41.0422] },
];

export const sdkShotTraffic: DeviceTest = test('sdk.shot-traffic', 'Trafik görünümü: yoğun saatte 4 uzaklıkta harita durur, sunucuya işaret gider (bilgi)', (ctx) =>
  withTour(
    ctx,
    async (tour) => {
      for (const view of TRAFFIC_VIEWS) {
        tour.say('');
        await tour.go({ center: view.at, zoom: view.zoom }, 'jump');
        await tour.until(['roads_'], REGION_FEATURES, 12000).catch(() => undefined);
        await pause(SETTLE_MS);
        await fetch(`${ctx.packServerUrl}/mark/traffic-z${view.zoom}`).catch(() => undefined);
        await pause(HOLD_MS);
      }
      return { outcome: 'info', note: `${TRAFFIC_VIEWS.length} uzaklık, yoğun saat` };
    },
    { look: { theme: 'light', lang: 'tr', traffic: TRAFFIC_RUSH } },
  ),
);

export const SHOT_TESTS: DeviceTest[] = [sdkShotTour, sdkShotTraffic];
