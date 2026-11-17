import { Directory, File } from 'expo-file-system';
import { createSearch } from '../../../../src/core/address/search';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';

type Expected = { status: string; top: { id: string; coordinate: [number, number]; poiName: string | null }[] };
type Case = { id: string; text: string; expected: Expected };

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrNames: DeviceTest = {
  id: 'sdk.addr-names',
  title: 'Bina adıyla arama: 40 sorgu (yazılmış ve bir harfi eksik) Node ile birebir ve hız',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/names.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-names-device-set.ts çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const dir: Directory = sandbox('addr-names', false);
    const open = createExpoOpener(dir);
    const dbs: SqlDb[] = [];
    try {
      await fetchFile(base, `reverse-${PLATE}-address.sqlite`, dir);
      await fetchFile(base, `buildings2-names-${PLATE}.sqlite`, dir);
      const address: SqlDb = await open(`reverse-${PLATE}-address.sqlite`);
      const buildings: SqlDb = await open(`buildings2-names-${PLATE}.sqlite`);
      dbs.push(address, buildings);
      const search = createSearch({ store: { installed: async () => [PLATE], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) }, borders: embeddedBorders() });
      await search.warm(PLATE);
      const different: string[] = [];
      const times: number[] = [];
      let found = 0;
      for (const c of cases) {
        const started = performance.now();
        const result = await search.resolve(c.text, { limit: 5 });
        times.push(performance.now() - started);
        const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
        const got: Expected = { status: result.status, top: top.map((p) => ({ id: p.id, coordinate: [round(p.coordinate[0]), round(p.coordinate[1])] as [number, number], poiName: p.components.poiName ?? null })) };
        if (got.top.some((p) => p.id.includes(':b:'))) found++;
        if (JSON.stringify(got) !== JSON.stringify(c.expected)) different.push(c.id);
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} sorgu, ${found} tanesinde ilk üçte bina adı sonucu; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; süre ortanca ${quantile(times, 0.5).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`;
      return { outcome: different.length === 0 && found > 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      for (const db of dbs) await db.close();
    }
  },
};
