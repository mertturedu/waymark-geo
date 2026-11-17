import type { DeviceTest } from '../../device-test/types';
import { lineCount } from '../../../../src/native/map/abbreviate';
import { KADIKOY, LABELS, settle, test, withTour } from './map-tour';

const LANGUAGES = ['tr', 'en', 'de', 'ar', 'ru', 'el'];
const MIN_LABELS = 20;
const TEXT_LAYERS = [...LABELS, 'ov-icon@', 'service@'];

export const sdkMapLanguages: DeviceTest = test('sdk.map-languages', 'Harita turu: 6 dilin her birinde stil yüklenir ve en az 20 yazı çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: 16 }, 'jump');
    const lines: string[] = [];
    for (const lang of LANGUAGES) {
      tour.say(`Dil: ${lang}`);
      const loadMs = await tour.look({ lang });
      const labels = await settle(tour, TEXT_LAYERS, MIN_LABELS);
      lines.push(`${lang} ${labels.length} yazı (${Math.round(loadMs)} ms)`);
      if (labels.length < MIN_LABELS) return { outcome: 'fail', note: `${lines.join('; ')}; en az ${MIN_LABELS} beklenir` };
    }
    return { outcome: 'pass', note: lines.join('; ') };
  }),
);

export const sdkMapLabelLines: DeviceTest = test('sdk.map-label-lines', 'Harita turu: çizilen yer adlarında 2 satırı aşan ad sayısı (bilgi)', (ctx) =>
  withTour(ctx, async (tour) => {
    const lines: string[] = [];
    for (const [name, at] of [['Kadıköy', KADIKOY], ['Beşiktaş', [29.0097, 41.0422]], ['Üsküdar', [29.0153, 41.0226]]] as const) {
      tour.say(`${name}: yer adları`);
      await tour.go({ center: [at[0], at[1]], zoom: 16 }, 'jump');
      const placed = await settle(tour, ['ov-icon@'], 1);
      const names = placed.map((feature) => String(feature.properties?.ns ?? feature.properties?.name ?? '')).filter((text) => text !== '');
      const over = names.filter((text) => lineCount(text) > 2).length;
      lines.push(`${name} ${over}/${names.length}`);
    }
    return { outcome: 'info', note: `2 satırı aşan / toplam: ${lines.join(', ')}` };
  }),
);

export const MAP_LABEL_TESTS: DeviceTest[] = [sdkMapLanguages, sdkMapLabelLines];
