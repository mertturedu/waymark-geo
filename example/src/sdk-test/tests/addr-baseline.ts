import { createGeoNative } from '../../../../src/native';
import { distanceM } from '../../../../src/core/geo/distance';
import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { manifestUrlOf, sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';

type DeviceCase = { id: string; text: string; truth: [number, number]; expected: { status: string; point: [number, number] | null; precision: string | null } };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

export const sdkAddrBaseline: DeviceTest = {
  id: 'sdk.addr-baseline',
  title: 'Adres tabanı: İstanbul G2 alt kümesi (300 dağınık adres), doğruluk, hız ve Node ile birebir eşlik',
  kind: 'auto',
  async run(ctx) {
    const response = await fetch(`${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device/${PLATE}.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/addr-device-set.ts ${PLATE} çalıştırılmalı` };
    const cases = (await response.json()) as DeviceCase[];
    const dir = sandbox('addr-baseline', false);
    const geo = await createGeoNative({ manifestUrl: manifestUrlOf(ctx), publicKeys: PUBLIC_KEY ? [PUBLIC_KEY] : [], directory: dir });
    try {
      if (!geo.regions.status(PLATE).installedParts.includes('address')) {
        const checked = await geo.regions.checkUpdates();
        if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
        await geo.regions.download(PLATE, { parts: ['address'] });
      }
      const errors: number[] = [];
      const ms: number[] = [];
      const mismatched: string[] = [];
      for (const c of cases) {
        const started = Date.now();
        const result = await geo.search.resolve(c.text);
        ms.push(Date.now() - started);
        const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
        errors.push(best ? distanceM(best.coordinate, c.truth) : 100_000);
        const same = result.status === c.expected.status && (best && c.expected.point ? distanceM(best.coordinate, c.expected.point) <= 0.5 : !best && !c.expected.point);
        if (!same) mismatched.push(c.id);
      }
      const within = (m: number): string => `${Math.round((1000 * errors.filter((e) => e <= m).length) / errors.length) / 10}`;
      const note = `${cases.length} adres; ≤15 m %${within(15)}, ≤30 m %${within(30)}, ≤50 m %${within(50)}; hata ortanca ${Math.round(quantile(errors, 0.5))} m, p90 ${Math.round(quantile(errors, 0.9))} m; süre ortanca ${quantile(ms, 0.5)} ms, p95 ${quantile(ms, 0.95)} ms; Node ile eşlik ${cases.length - mismatched.length}/${cases.length}${mismatched.length > 0 ? ` (farklı: ${mismatched.slice(0, 5).join(', ')})` : ''}`;
      return { outcome: mismatched.length === 0 ? 'pass' : 'fail', value: String(quantile(ms, 0.95)), unit: 'ms (p95)', note };
    } finally {
      await geo.dispose();
    }
  },
};
