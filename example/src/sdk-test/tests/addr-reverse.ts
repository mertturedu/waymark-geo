import { Directory, File } from 'expo-file-system';
import { openBuildings2 } from '../../../../src/core/address/buildings2';
import { createSearch, type Search } from '../../../../src/core/address/search';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATES = ['34', '35'];

type Tap = { id: string; plate: string; point: [number, number]; options: { heading?: number; accuracyM?: number }; expected: unknown };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrReverse: DeviceTest = {
  id: 'sdk.addr-reverse',
  title: 'Nokta → adres v2: iki ilde 40 dokunma (kapı, tahmini numara, taraf, çevre kapılar, bina bilgisi) Node ile birebir ve hız',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/reverse-cases.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-reverse-device-set.ts çalıştırılmalı` };
    const cases = (await response.json()) as Tap[];
    const dir: Directory = sandbox('addr-reverse', false);
    const open = createExpoOpener(dir);
    const dbs: SqlDb[] = [];
    const searches = new Map<string, Search>();
    try {
      for (const plate of PLATES) {
        await fetchFile(base, `reverse-${plate}-address.sqlite`, dir);
        await fetchFile(base, `buildings2-${plate}.sqlite`, dir);
        const address: SqlDb = await open(`reverse-${plate}-address.sqlite`);
        const buildings: SqlDb = await open(`buildings2-${plate}.sqlite`);
        dbs.push(address, buildings);
        await openBuildings2(buildings);
        searches.set(plate, createSearch({ store: { installed: async () => [plate], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) }, borders: embeddedBorders() }));
      }
      const opening: string[] = [];
      for (const plate of PLATES) {
        const started = performance.now();
        await (searches.get(plate) as Search).warm(plate);
        opening.push(`${plate}: ${(performance.now() - started).toFixed(0)} ms`);
      }
      const different: string[] = [];
      const times: number[] = [];
      const named: { id: string; ms: number }[] = [];
      let withNumber = 0;
      for (const c of cases) {
        const started = performance.now();
        const place = await (searches.get(c.plate) as Search).reverse(c.point, c.options);
        times.push(performance.now() - started);
        named.push({ id: c.id, ms: times[times.length - 1] as number });
        if (place?.components.houseNumber) withNumber++;
        if (JSON.stringify(place) !== JSON.stringify(c.expected)) different.push(c.id);
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} dokunma (2 il), ${withNumber} tanesinde numara; il açılışı (warm) ${opening.join(', ')}; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; süre ortanca ${quantile(times, 0.5).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms; en yavaş ${named.sort((a, b) => b.ms - a.ms).slice(0, 4).map((n) => `${n.id}:${n.ms.toFixed(0)}`).join(' ')}`;
      return { outcome: different.length === 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      for (const db of dbs) await db.close();
    }
  },
};
