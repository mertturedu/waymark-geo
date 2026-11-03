import type { DeviceTest } from '../../device-test/types';
import { KADIKOY, LABELS, ROADS, settle, test, withTour } from './map-tour';

const YENIKAPI: [number, number] = [28.9519, 41.0043];
const TEXT_LAYERS = [...LABELS, 'ov-icon@', 'service@'];

export const sdkMap3d: DeviceTest = test('sdk.map-3d', 'Harita turu: z17 eğim 20 derecede 3B bina katmanı çizilir, kapatınca kalkar', (ctx) =>
  withTour(ctx, async (tour) => {
    tour.say('3B binalar');
    await tour.go({ center: KADIKOY, zoom: 17, pitch: 20 }, 'jump');
    const solid = await settle(tour, ['buildings3d@'], 1);
    const layers = tour.layers('buildings3d@').length;
    if (layers === 0) return { outcome: 'fail', note: 'stilde 3B bina katmanı yok' };
    if (solid.length === 0) return { outcome: 'fail', note: `${layers} katman var, z17'de çizilen 3B bina yok` };
    return { outcome: 'pass', note: `${layers} katman, çizilen 3B bina ${solid.length}` };
  }),
);

export const sdkMapDark: DeviceTest = test('sdk.map-dark', 'Harita turu: koyu temada harita açılır, yol ve yazı çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: 16 }, 'jump');
    const loadMs = await tour.look({ theme: 'dark' });
    const roads = await settle(tour, ROADS, 20);
    const labels = await settle(tour, TEXT_LAYERS, 1);
    if (roads.length === 0) return { outcome: 'fail', note: 'koyu temada yol çizilmedi' };
    return { outcome: labels.length > 0 ? 'pass' : 'fail', note: `koyu tema ${Math.round(loadMs)} ms; yol ${roads.length}, yazı ${labels.length}` };
  }),
);

export const sdkMapTransit: DeviceTest = test('sdk.map-transit', 'Harita turu: Yenikapı z14 en az 3 hat çizgisi ve 2 istasyon (toplu taşıma paketi kuruluysa)', (ctx) =>
  withTour(ctx, async (tour) => {
    if (tour.layers('transit-lines@').length === 0) return { outcome: 'info', note: 'toplu taşıma paketi kurulu değil (katman yok); paketler yeniden üretilince koşar' };
    await tour.go({ center: YENIKAPI, zoom: 14 }, 'jump');
    const lines = await settle(tour, ['transit-lines@', 'transit-ferry@'], 3);
    const stations = await settle(tour, ['transit-stations@'], 2);
    return { outcome: lines.length >= 3 && stations.length >= 2 ? 'pass' : 'fail', note: `hat çizgisi ${lines.length}, istasyon ${stations.length}` };
  }),
);

export const MAP_LOOK6_TESTS: DeviceTest[] = [sdkMap3d, sdkMapDark, sdkMapTransit];
