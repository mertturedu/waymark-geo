import type { GeoNative } from '../../../../src/native';
import type { DeviceTest, TestContext, TestResult } from '../../device-test/types';
import { manifestUrlOf, openGeo } from '../sandbox';
import { median, round, round1, type Round } from './perf-regions';

const PARTS = ['tiles', 'places', 'address'] as const;

async function open(ctx: TestContext, name: string, base: string): Promise<GeoNative> {
  const { geo } = await openGeo(ctx, name, { wipe: false, manifestUrl: `${base}/manifest-v1.json` });
  const checked = await geo.regions.checkUpdates();
  if (!checked.ok) throw new Error(`${name}: manifest alınamadı (${checked.code})`);
  if (geo.regions.status('34').state !== 'installed') await geo.regions.download('34', { parts: [...PARTS] });
  return geo;
}

const gain = (a: number, b: number): string => `${Math.round((1 - b / a) * 100)}%`;

export const sdkPerfPlaceProps: DeviceTest = {
  id: 'sdk.perf-place-props',
  title: 'Performans: simge sınıflandırması stilde hesaplanır ile veride hazır (bilgi)',
  kind: 'auto',
  async run(ctx): Promise<TestResult> {
    const root = manifestUrlOf(ctx).replace(/\/manifest-v1\.json$/, '');
    const plain = await open(ctx, 'perf-plain', root);
    const baked = await open(ctx, 'perf-baked', `${root}/k`);
    try {
      const a: Round[] = [];
      const b: Round[] = [];
      for (let i = 0; i < 4; i += 1) {
        a.push(await round(plain, { theme: 'light', lang: 'tr' }));
        b.push(await round(baked, { theme: 'light', lang: 'tr' }));
      }
      const open0 = [median(a.map((r) => r.openMs)), median(b.map((r) => r.openMs))];
      const pan = [median(a.map((r) => r.p95)), median(b.map((r) => r.p95))];
      const p50 = [median(a.map((r) => r.p50)), median(b.map((r) => r.p50))];
      const note = `İstanbul z16; stilde hesaplanır: açılış ${open0[0]} ms, kaydırma p95 ${pan[0]} ms, p50 ${round1(p50[0]!)} ms; veride hazır: açılış ${open0[1]} ms, kaydırma p95 ${pan[1]} ms, p50 ${round1(p50[1]!)} ms; dörder tur ortancası; kazanç açılış ${gain(open0[0]!, open0[1]!)}, kaydırma ${gain(pan[0]!, pan[1]!)}; ham p95 ${a.map((r) => r.p95).join('/')} ve ${b.map((r) => r.p95).join('/')}`;
      return { outcome: 'info', value: gain(pan[0]!, pan[1]!), unit: 'kaydırma p95 kazancı', note };
    } finally {
      await plain.dispose();
      await baked.dispose();
    }
  },
};

export const PERF_PROPS_TESTS: DeviceTest[] = [sdkPerfPlaceProps];
