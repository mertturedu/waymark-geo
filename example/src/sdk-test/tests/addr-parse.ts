import { parseAddress } from '../../../../src/core/text';
import { summaryOf, type ParseSummary } from '../../../../src/core/text/summary';
import type { DeviceTest } from '../../device-test/types';

const DATA_VERSION = '20261028.20261030.3';

type ParseCase = { id: string; text: string; expect: ParseSummary };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

export const sdkAddrParse: DeviceTest = {
  id: 'sdk.addr-parse',
  title: 'Adres ayrıştırma: 3.000 dağınık adres cihazda, Node ile birebir ve p95 ≤ 3 ms',
  kind: 'auto',
  async run(ctx) {
    const response = await fetch(`${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device/parse-v2.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-parse-v2.ts çalıştırılmalı` };
    const cases = ((await response.json()) as { cases: ParseCase[] }).cases;
    const ms: number[] = [];
    const different: string[] = [];
    for (const c of cases) {
      const started = performance.now();
      const parsed = parseAddress(c.text);
      ms.push(performance.now() - started);
      if (JSON.stringify(summaryOf(parsed)) !== JSON.stringify(c.expect)) different.push(c.id);
    }
    const p95 = quantile(ms, 0.95);
    const note = `${cases.length} adres; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; süre ortanca ${quantile(ms, 0.5).toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, en uzun ${Math.max(...ms).toFixed(1)} ms`;
    return { outcome: different.length === 0 && p95 <= 3 ? 'pass' : 'fail', value: p95.toFixed(2), unit: 'ms (p95)', note };
  },
};
