import { embeddedBorders } from '../../../../src/core';
import type { DeviceTest } from '../../device-test/types';
import { timingNote } from '../../device-test/address-search-helpers';

const CITIES: [string, string, [number, number]][] = [
  ['34', 'İstanbul Kadıköy', [29.0287, 40.9903]],
  ['06', 'Ankara Kızılay', [32.8541, 39.9208]],
  ['35', 'İzmir Konak', [27.1286, 38.4189]],
  ['20', 'Denizli merkez', [29.0875, 37.7765]],
  ['42', 'Konya merkez', [32.4846, 37.8746]],
  ['16', 'Bursa merkez', [29.061, 40.1826]],
  ['38', 'Kayseri merkez', [35.4787, 38.7312]],
  ['58', 'Sivas merkez', [37.0179, 39.7477]],
  ['45', 'Manisa merkez', [27.4289, 38.6191]],
  ['41', 'Kocaeli İzmit', [29.9187, 40.7654]],
  ['59', 'Tekirdağ merkez', [27.511, 40.978]],
  ['10', 'Balıkesir merkez', [27.8826, 39.6484]],
];

export const sdkRegionDetect: DeviceTest = {
  id: 'sdk.region-detect',
  title: 'İl bulma: 12 şehir ve il sınırı',
  kind: 'auto',
  async run() {
    const borders = embeddedBorders();
    const wrong = CITIES.filter(([plate, , point]) => borders.provinceAt(point[0], point[1]) !== plate).map(([plate, name]) => `${name} (beklenen ${plate})`);
    const times: number[] = [];
    for (let i = 0; i < 300; i++) {
      const [, , point] = CITIES[i % CITIES.length] as (typeof CITIES)[number];
      const started = performance.now();
      borders.nearBorder(point[0] + (i % 7) * 0.0001, point[1], 1000);
      times.push(performance.now() - started);
    }
    let border = 'İstanbul-Kocaeli sınır noktası bulunamadı';
    for (let dx = -0.08; dx <= 0.08 && border.includes('bulunamadı'); dx += 0.004) {
      const x = 29.38 + dx;
      if (borders.provinceAt(x, 40.8) === '34' && borders.nearBorder(x, 40.8, 1000).includes('41')) border = `İstanbul ile Kocaeli sınırı bulundu (${x.toFixed(3)}, 40.8)`;
    }
    const { p95 } = timingNote(times);
    if (wrong.length > 0) return { outcome: 'fail', note: `yanlış il: ${wrong.join(', ')}` };
    return { outcome: 'pass', value: '12/12', note: `${border}; nearBorder p95 ${p95.toFixed(1)} ms` };
  },
};
