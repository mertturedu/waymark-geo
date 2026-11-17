import type { DeviceTest } from '../../device-test/types';
import { percentile } from './helpers';
import { heapNote } from './memory';
import { KADIKOY, ms, test, withTour, type Tour } from './map-tour';
import { offset, panPath } from './pan-path';

const PAN_STEPS = 20;
const PAN_M = 350;
const PAN_ZOOM = 16;

const styleLoads = (tour: Tour): number => tour.events().filter((event) => event.startsWith('style@')).length;

export const sdkPerfMapOpen = test('sdk.perf-map-open', 'Performans: haritanın ilk tam karesi (bilgi)', (ctx) =>
  withTour(ctx, async (tour, openMs) => {
    tour.say('Açılış ölçülüyor');
    const layers = tour.layers('').length;
    const installed = tour.geo.regions.installed().length;
    return { outcome: 'info', value: String(openMs), unit: 'ms', note: `stil yükleme ${styleLoads(tour)} kez, ${layers} katman, ${installed} il kurulu` };
  }),
);

export const sdkPerfPan = test('sdk.perf-pan', 'Performans: z16 kaydırmada tam çizime kadar süre (bilgi)', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: PAN_ZOOM }, 'jump');
    const times: number[] = [];
    for (const [index, center] of panPath(KADIKOY, PAN_STEPS, PAN_M).entries()) {
      tour.say(`Kaydırma ${index + 1}/${PAN_STEPS}`);
      const before = tour.frames();
      const started = Date.now();
      await tour.step({ center, zoom: PAN_ZOOM });
      await tour.rendered(before);
      times.push(Date.now() - started);
    }
    const p50 = percentile(times, 0.5);
    const p95 = percentile(times, 0.95);
    return { outcome: 'info', value: String(Math.round(p95)), unit: 'ms p95', note: `p50 ${Math.round(p50)} ms, tümü ${ms(times)}; ölçü: atlamadan sonraki ilk tam çizilmiş kare (eski 1118 ms ölçüsü yerleşme beklemesini de sayıyordu)` };
  }),
);

export const sdkPerfJsGap = test('sdk.perf-js-gap', 'Performans: uçuş ve yakınlaşmada en uzun JS boşluğu (bilgi)', (ctx) =>
  withTour(ctx, async (tour) => {
    const flights = [
      { center: KADIKOY, zoom: 12 },
      { center: KADIKOY, zoom: 16 },
      { center: offset(KADIKOY, -2500, 5800), zoom: 15 },
      { center: offset(KADIKOY, -2500, 5800), zoom: 17.5 },
      { center: KADIKOY, zoom: 14 },
    ];
    const run = await tour.gaps(async () => {
      for (const view of flights) await tour.go(view, 'fly', 1200);
    });
    return { outcome: 'info', value: String(run.maxGapMs), unit: 'ms', note: `${run.ticks} tik, 5 uçuş` };
  }),
);

export const sdkPerfMemory = test('sdk.perf-memory', 'Performans: harita açık, 30 sn gezinme sonrası JS yığını (bilgi)', (ctx) =>
  withTour(ctx, async (tour) => {
    const started = Date.now();
    let step = 0;
    while (Date.now() - started < 30000) {
      const [center] = panPath(KADIKOY, (step % 12) + 1, 400).slice(-1);
      await tour.go({ center: center!, zoom: 15 + (step % 3) }, 'jump');
      step += 1;
    }
    return { outcome: 'info', value: heapNote(), note: `${step} görünüm; yerel bellek iPhone'da JS'ten okunamaz, simülatörde device-run --rss ile ölçülür` };
  }),
);

export const PERF_TESTS: DeviceTest[] = [sdkPerfMapOpen, sdkPerfPan, sdkPerfJsGap, sdkPerfMemory];
