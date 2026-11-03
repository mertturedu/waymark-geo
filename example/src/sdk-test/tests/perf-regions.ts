import type { GeoNative, PlanControls } from '../../../../src/native';
import type { DeviceTest, TestContext, TestResult } from '../../device-test/types';
import { openTour, type Look, type LngLat } from '../map-tour/driver';
import { openGeo } from '../sandbox';
import { percentile } from './helpers';
import { DENIZLI, IZMIT, KADIKOY, REGION_FEATURES, withTour, type Tour } from './map-tour';
import { panPath } from './pan-path';

const SMALL = ['69', '76', '79', '71', '75', '30'];
const BIG = ['34'];
const PARTS = ['tiles', 'places', 'address'] as const;
const PANS = 16;

async function ensure(ctx: TestContext): Promise<GeoNative> {
  const { geo } = await openGeo(ctx, 'perf-many', { wipe: false });
  const checked = await geo.regions.checkUpdates();
  if (!checked.ok) throw new Error(`manifest alınamadı: ${checked.code}`);
  for (const id of [...BIG, ...SMALL]) if (geo.regions.status(id).state !== 'installed') await geo.regions.download(id, { parts: [...PARTS] });
  return geo;
}

export type Round = { windowed: boolean; openMs: number; styles: number; layers: number; p50: number; p95: number };

export async function round(geo: GeoNative, look: Look): Promise<Round> {
  const tour = await openTour<GeoNative, PlanControls>(geo, look);
  try {
    const openMs = await tour.ready();
    await tour.go({ center: KADIKOY, zoom: 16 }, 'jump');
    const times: number[] = [];
    for (const center of panPath(KADIKOY, PANS, 420)) {
      const before = tour.frames();
      const started = Date.now();
      await tour.step({ center, zoom: 16 });
      await tour.rendered(before);
      times.push(Date.now() - started);
    }
    const layers = tour.layers('').length;
    return { windowed: Boolean(look.window), openMs, styles: styleLoads(tour), layers, p50: percentile(times, 0.5), p95: percentile(times, 0.95) };
  } finally {
    tour.close();
  }
}

const styleLoads = (tour: Tour): number => tour.styleLoads();

export const median = (values: number[]): number => percentile(values, 0.5);
export const round1 = (value: number): string => (Math.round(value * 10) / 10).toString();

export const sdkPerfRegionWindow: DeviceTest = {
  id: 'sdk.perf-region-window',
  title: 'Performans: 7 il kurulu, tüm iller stilde ile yalnızca görünüme yakın iller (bilgi)',
  kind: 'auto',
  async run(ctx): Promise<TestResult> {
    const geo = await ensure(ctx);
    try {
      const rounds: Round[] = [];
      for (const windowed of [false, true, false, true, false, true]) rounds.push(await round(geo, { theme: 'light', lang: 'tr', ...(windowed ? { window: true } : {}) }));
      const of = (windowed: boolean) => rounds.filter((r) => r.windowed === windowed);
      const all = of(false);
      const win = of(true);
      const open = [median(all.map((r) => r.openMs)), median(win.map((r) => r.openMs))];
      const pan = [median(all.map((r) => r.p95)), median(win.map((r) => r.p95))];
      const gain = (a: number, b: number): string => `${Math.round((1 - b / a) * 100)}%`;
      const note = `kurulu ${1 + SMALL.length} il; tümü: ${all[0]!.layers} katman, açılış ${open[0]} ms, kaydırma p95 ${pan[0]} ms; pencereli: ${win[0]!.layers} katman, açılış ${open[1]} ms, kaydırma p95 ${pan[1]} ms; açılış kazancı ${gain(open[0]!, open[1]!)}, kaydırma kazancı ${gain(pan[0]!, pan[1]!)}; üçer tur ortancası; stil yükleme ${all.map((r) => r.styles).join('/')} ve ${win.map((r) => r.styles).join('/')}; p50 ${round1(median(all.map((r) => r.p50)))} ve ${round1(median(win.map((r) => r.p50)))} ms`;
      return { outcome: 'info', value: `${gain(pan[0]!, pan[1]!)}`, unit: 'kaydırma p95 kazancı', note };
    } finally {
      await geo.dispose();
    }
  },
};


export const sdkRegionSwitch: DeviceTest = {
  id: 'sdk.region-switch',
  title: 'Pencereli stil: İstanbul, Kocaeli, Denizli arasında uçuşta her geçişte stil bir kez yüklenir ve karolar çizilir',
  kind: 'auto',
  async run(ctx): Promise<TestResult> {
    return withTour(
      ctx,
      async (tour) => {
        const stops: { name: string; at: LngLat; zoom: number }[] = [
          { name: 'İstanbul', at: KADIKOY, zoom: 14 },
          { name: 'Kocaeli', at: IZMIT, zoom: 14 },
          { name: 'Denizli', at: DENIZLI, zoom: 13 },
          { name: 'İstanbul', at: KADIKOY, zoom: 14 },
        ];
        const lines: string[] = [];
        let before = tour.styleLoads();
        for (const stop of stops) {
          tour.say(`${stop.name}: geçiş`);
          const started = Date.now();
          await tour.go({ center: stop.at, zoom: stop.zoom }, 'fly', 1500);
          const roads = await tour.until(['roads_'], REGION_FEATURES, 12000);
          const loads = tour.styleLoads();
          const added = loads - before;
          before = loads;
          lines.push(`${stop.name} yol ${roads.count} (${roads.waitedMs} ms), stil +${added}, ${Date.now() - started} ms`);
          if (roads.count < REGION_FEATURES) return { outcome: 'fail', note: `${stop.name}: karo çizilmedi (yol ${roads.count}); ${lines.join(' | ')}` };
          if (added > 1) return { outcome: 'fail', note: `${stop.name}: geçişte stil ${added} kez yüklendi; ${lines.join(' | ')}` };
        }
        return { outcome: 'pass', note: lines.join(' | ') };
      },
      { look: { theme: 'light', lang: 'tr', window: true } },
    );
  },
};

export const PERF_REGION_TESTS: DeviceTest[] = [sdkPerfRegionWindow, sdkRegionSwitch];
