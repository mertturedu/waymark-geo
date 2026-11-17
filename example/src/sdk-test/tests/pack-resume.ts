import { createExpoNet } from '../../../../src/native';
import type { NetPort } from '../../../../src/core/packs/ports';
import type { DeviceTest } from '../../device-test/types';
import { openGeo } from '../sandbox';

function cutting(inner: NetPort, afterBytes: number): NetPort & { cuts: () => number; ranges: number[] } {
  let cuts = 0;
  const ranges: number[] = [];
  return {
    cuts: () => cuts,
    ranges,
    getText: (url, options) => inner.getText(url, options),
    async get(url, options) {
      if (options?.rangeStart) ranges.push(options.rangeStart);
      const response = await inner.get(url, options);
      if (!/address-/.test(url) || cuts > 0) return response;
      let sent = 0;
      return {
        status: response.status,
        body: (async function* () {
          for await (const chunk of response.body) {
            if (sent + chunk.length > afterBytes) {
              cuts += 1;
              throw new Error('bağlantı yapay olarak kesildi');
            }
            sent += chunk.length;
            yield chunk;
          }
        })(),
      };
    },
  };
}

export const sdkPackResume: DeviceTest = {
  id: 'sdk.pack-resume',
  title: 'Kesilen indirme sürer; duraklat ve sürdür',
  kind: 'auto',
  async run(ctx) {
    const net = cutting(createExpoNet(), 4_000_000);
    const { geo } = await openGeo(ctx, 'resume', { wipe: true, net });
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
      await geo.regions.download('34', { parts: ['address'] });
      if (geo.regions.status('34').state !== 'installed') return { outcome: 'fail', note: 'kesilen indirme tamamlanmadı' };
      if (net.cuts() < 1) return { outcome: 'fail', note: 'kesinti oluşmadı, test geçersiz' };
      if (!net.ranges.some((r) => r >= 3_000_000)) return { outcome: 'fail', note: 'indirme kaldığı yerden değil baştan başladı' };

      let paused = false;
      await geo.regions
        .download('41', {
          parts: ['address'],
          onProgress: (done, total) => {
            if (!paused && done > total * 0.3) {
              paused = true;
              void geo.regions.pause('41');
            }
          },
        })
        .catch(() => undefined);
      const stopped = geo.regions.status('41');
      if (stopped.state !== 'paused') return { outcome: 'fail', note: `duraklatılınca durum ${stopped.state}` };
      await geo.regions.resume('41');
      const finished = geo.regions.status('41');
      if (finished.state !== 'installed') return { outcome: 'fail', note: `sürdürülünce durum ${finished.state}` };
      return { outcome: 'pass', note: `kesinti sonrası devam ${Math.round(Math.max(...net.ranges) / 1000)} KB noktasından; Kocaeli adres paketi duraklatılıp sürdürüldü` };
    } finally {
      await geo.dispose();
    }
  },
};
