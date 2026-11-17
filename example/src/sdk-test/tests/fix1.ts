import type { DeviceTest } from '../../device-test/types';
import { IZMIT, KADIKOY, test, withTour } from './map-tour';


export const sdkMapOpenOnce = test('sdk.map-open-once', 'Harita açılışında stil tek kez yüklenir, mahalle adları sonradan gelse de', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: 14 }, 'jump');
    const hoods = await tour.until(['hood-labels'], 1, 8000);
    const loads = tour.styleLoads();
    const note = `stil yükleme ${loads} kez, mahalle adı ${hoods.count} (${hoods.waitedMs} ms)`;
    if (loads !== 1) return { outcome: 'fail', value: String(loads), threshold: '1', note };
    if (hoods.count === 0) return { outcome: 'fail', value: String(loads), note: `mahalle adı çizilmedi; ${note}` };
    return { outcome: 'pass', value: String(loads), threshold: '1', note };
  }),
);

const turn = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);

export const sdkCameraBearing = test('sdk.camera-bearing', 'Kamera: negatif yön 0-360 aralığına çevrilir, eğimli uzak atlamada zoom tutar', (ctx) =>
  withTour(ctx, async (tour) => {
    const bad: string[] = [];
    const turned = await tour.jumpSafe({ center: KADIKOY, zoom: 16, bearing: -90 });
    if (turn(turned.bearing ?? 0, 270) > 1) bad.push(`yön ${turned.bearing?.toFixed(1)} (istenen 270)`);
    await tour.jumpSafe({ center: KADIKOY, zoom: 16, pitch: 20 });
    const far = await tour.jumpSafe({ center: IZMIT, zoom: 16, pitch: 20 });
    const drift = Math.abs(far.zoom - 16);
    if (drift > 0.05) bad.push(`uzak atlamada zoom ${far.zoom.toFixed(3)} (istenen 16)`);
    const note = `yön ${turned.bearing?.toFixed(1)}, uzak atlama zoom ${far.zoom.toFixed(3)} eğim ${(far.pitch ?? 0).toFixed(1)}`;
    return bad.length > 0 ? { outcome: 'fail', note: `${bad.join('; ')} | ${note}` } : { outcome: 'pass', value: drift.toFixed(3), unit: 'zoom sapması', threshold: '≤ 0,05', note };
  }),
);

export const FIX1_TESTS: DeviceTest[] = [sdkMapOpenOnce, sdkCameraBearing];
