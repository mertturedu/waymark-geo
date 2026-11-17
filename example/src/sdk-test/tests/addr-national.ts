import { Directory, File } from 'expo-file-system';
import { createSearch } from '../../../../src/core/address/search';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '67';

type Case = { id: string; text: string; source: number; expected: { status: string; top: string } };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrNational: DeviceTest = {
  id: 'sdk.addr-national',
  title: 'Ulusal mahalle ve köy birimleri: 56 sorgu (OSM çokgeni, türetilen alan, yalnız resmî liste) Node ile birebir ve hız',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/national.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-national-device-set.ts çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const dir: Directory = sandbox('addr-national', false);
    const open = createExpoOpener(dir);
    const dbs: SqlDb[] = [];
    try {
      await fetchFile(base, `national-${PLATE}-address.sqlite`, dir);
      const address: SqlDb = await open(`national-${PLATE}-address.sqlite`);
      dbs.push(address);
      const search = createSearch({ store: { installed: async () => [PLATE], open: async () => address, openPart: async () => null }, borders: embeddedBorders() });
      await search.warm(PLATE);
      const different: string[] = [];
      const times: number[] = [];
      let derived = 0;
      let officialOnly = 0;
      for (const c of cases) {
        const started = performance.now();
        const result = await search.resolve(c.text, { geometry: true, limit: 5 });
        times.push(performance.now() - started);
        const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
        const got = JSON.stringify(top.map((p) => ({ id: p.id, name: p.label, point: p.coordinate, bbox: p.bbox ?? null, geometry: p.geometry ?? null })));
        if (c.source === 3 && top[0]?.geometry?.kind === 'area') derived++;
        if (c.source === 5 && top.length > 0) officialOnly++;
        if (result.status !== c.expected.status || got !== c.expected.top) different.push(c.id);
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} sorgu, türetilen alanlı ${derived}, yalnız resmî listeden bulunan ${officialOnly}; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}`;
      return { outcome: different.length === 0 && derived > 0 && officialOnly > 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      for (const db of dbs) await db.close();
    }
  },
};
