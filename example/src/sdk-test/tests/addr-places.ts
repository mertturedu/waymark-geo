import { Directory, File } from 'expo-file-system';
import { openBuildings2 } from '../../../../src/core/address/buildings2';
import { createSearch } from '../../../../src/core/address/search';
import { distanceM } from '../../../../src/core/geo/distance';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';

type Top = { coordinate: [number, number]; relation: string | null; radiusM: number | null; notes: string[] };
type Case = { id: string; text: string; expected: { status: string; top: Top[] } };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrPlaces: DeviceTest = {
  id: 'sdk.addr-places',
  title: 'Yer ve yer işareti: 72 sorgu (karşısı, yanı, arkası, köşesi, ad, kategori) Node ile birebir ve hız',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/places-${PLATE}.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-places-device-set.ts ${PLATE} çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const dir: Directory = sandbox('addr-places', false);
    await fetchFile(base, `sequence-${PLATE}-address.sqlite`, dir);
    await fetchFile(base, `buildings2-${PLATE}.sqlite`, dir);
    const open = createExpoOpener(dir);
    const address: SqlDb = await open(`sequence-${PLATE}-address.sqlite`);
    const buildings: SqlDb = await open(`buildings2-${PLATE}.sqlite`);
    try {
      await openBuildings2(buildings);
      const search = createSearch({ store: { installed: async () => [PLATE], open: async () => address, openPart: async (_: string, kind: string) => (kind === 'buildings2' ? buildings : null) }, borders: embeddedBorders() });
      const different: string[] = [];
      const times: number[] = [];
      const named: { id: string; ms: number }[] = [];
      let related = 0;
      for (const c of cases) {
        const started = performance.now();
        const result = await search.resolve(c.text, { limit: 3 });
        times.push(performance.now() - started);
        named.push({ id: c.id, ms: times[times.length - 1] as number });
        const list = result.status === 'region_missing' ? [] : result.status === 'resolved' ? [result.best, ...result.candidates.filter((p) => p.id !== result.best.id)] : result.candidates;
        const top = list.slice(0, 3);
        if (top.some((p) => p.relation)) related++;
        const same = result.status === c.expected.status && top.length === c.expected.top.length && top.every((p, i) => {
          const want = c.expected.top[i] as Top;
          return distanceM(p.coordinate, want.coordinate) <= 0.5 && (p.relation?.kind ?? null) === want.relation && (p.radiusM ?? null) === want.radiusM && JSON.stringify(p.notes ?? []) === JSON.stringify(want.notes);
        });
        if (!same) different.push(c.id);
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} sorgu, ${related} tanesi yer işaretine göre; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; süre ortanca ${quantile(times, 0.5).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms; en yavaş ${named.sort((a, b) => b.ms - a.ms).slice(0, 4).map((n) => `${n.id}:${n.ms.toFixed(0)}`).join(' ')}`;
      return { outcome: different.length === 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      await address.close();
      await buildings.close();
    }
  },
};
