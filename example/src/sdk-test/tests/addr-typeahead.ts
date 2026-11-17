import { Directory, File } from 'expo-file-system';
import { createSearch } from '../../../../src/core/address/search';
import { createTypeSession } from '../../../../src/core/address/typeahead';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';

type TypeCase = { id: string; text: string; expected: string[] };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrTypeahead: DeviceTest = {
  id: 'sdk.addr-typeahead',
  title: 'Yazarken öneri: 100 metin tuş tuş otomatik yazılır (oturumlu), her tuşta ilk 3 öneri Node ile birebir ve tuş başına süre',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/typeahead-${PLATE}.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-typeahead-device-set.ts çalıştırılmalı` };
    const cases = (await response.json()) as TypeCase[];
    const dir: Directory = sandbox('addr-typeahead', false);
    await fetchFile(base, `sequence-${PLATE}-address.sqlite`, dir);
    const open = createExpoOpener(dir);
    const address: SqlDb = await open(`sequence-${PLATE}-address.sqlite`);
    try {
      const search = createSearch({ store: { installed: async () => [PLATE], open: async () => address }, borders: embeddedBorders() });
      const different: string[] = [];
      const times: number[] = [];
      const slow: { id: string; k: number; ms: number }[] = [];
      let keys = 0;
      for (const c of cases) {
        const session = createTypeSession();
        let wrong = 0;
        for (let k = 1; k <= c.text.length; k++) {
          const started = performance.now();
          const list = await search.autocomplete(c.text.slice(0, k), { limit: 3, session });
          const ms = performance.now() - started;
          times.push(ms);
          slow.push({ id: c.id, k, ms });
          keys++;
          if (list.map((p) => p.id).join('|') !== c.expected[k - 1]) wrong++;
        }
        if (wrong > 0) different.push(`${c.id}:${wrong}`);
      }
      const p95 = quantile(times, 0.95);
      const worst = slow.sort((a, b) => b.ms - a.ms).slice(0, 3).map((s) => `${s.id}@${s.k}:${s.ms.toFixed(0)}`).join(' ');
      const note = `${cases.length} metin, ${keys} tuş; Node ile eşlik ${cases.length - different.length}/${cases.length} metin${different.length > 0 ? ` (farklı: ${different.slice(0, 4).join(', ')})` : ''}; tuş başına ortanca ${quantile(times, 0.5).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, p99 ${quantile(times, 0.99).toFixed(1)} ms; en yavaş ${worst}`;
      return { outcome: different.length === 0 ? 'pass' : 'fail', value: p95.toFixed(1), unit: 'ms (p95)', note };
    } finally {
      await address.close();
    }
  },
};
