import { Directory, File } from 'expo-file-system';
import { createSearch } from '../../../../src/core/address/search';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';

type Case = { id: string; text: string; expected: { status: string; top: string } };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrShapes: DeviceTest = {
  id: 'sdk.addr-shapes',
  title: 'Sokak ve alan geometrisi: 60 sorgu (sokak çizgisi, mahalle ve ilçe sınırı, bbox) Node ile birebir ve hız',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/shapes.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-shapes-device-set.ts çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const dir: Directory = sandbox('addr-shapes', false);
    const open = createExpoOpener(dir);
    const dbs: SqlDb[] = [];
    try {
      await fetchFile(base, `reverse-${PLATE}-address.sqlite`, dir);
      const address: SqlDb = await open(`reverse-${PLATE}-address.sqlite`);
      dbs.push(address);
      const search = createSearch({ store: { installed: async () => [PLATE], open: async () => address, openPart: async () => null }, borders: embeddedBorders() });
      await search.warm(PLATE);
      const different: string[] = [];
      const times: number[] = [];
      let streets = 0;
      let areas = 0;
      for (const c of cases) {
        const started = performance.now();
        const result = await search.resolve(c.text, { geometry: true, limit: 5 });
        times.push(performance.now() - started);
        const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
        const got = JSON.stringify(top.map((p) => ({ id: p.id, bbox: p.bbox ?? null, geometry: p.geometry ?? null })));
        if (top.some((p) => p.geometry?.kind === 'street')) streets++;
        if (top.some((p) => p.geometry?.kind === 'area')) areas++;
        if (result.status !== c.expected.status || got !== c.expected.top) different.push(c.id);
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} sorgu, ${streets} tanesinde sokak çizgisi, ${areas} tanesinde alan sınırı; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; süre ortanca ${quantile(times, 0.5).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`;
      return { outcome: different.length === 0 && streets > 0 && areas > 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      for (const db of dbs) await db.close();
    }
  },
};
