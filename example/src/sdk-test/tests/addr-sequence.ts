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

type Case = { id: string; text: string; expected: { status: string; point: [number, number] | null; radiusM: number | null; notes: string[] } };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrSequence: DeviceTest = {
  id: 'sdk.addr-sequence',
  title: 'Kapı tahmini v2: kapısı olmayan 160 numara bina dizisiyle, Node ile birebir (nokta, yarıçap, not) ve hız',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/sequence-${PLATE}.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-sequence-device-set.ts ${PLATE} çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const dir: Directory = sandbox('addr-sequence', false);
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
      let sequenced = 0;
      for (const c of cases) {
        const started = performance.now();
        const result = await search.resolve(c.text);
        times.push(performance.now() - started);
        const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
        if (best?.radiusM !== undefined) sequenced++;
        const samePoint = best && c.expected.point ? distanceM(best.coordinate, c.expected.point) <= 0.5 : !best && !c.expected.point;
        const same = result.status === c.expected.status && samePoint && (best?.radiusM ?? null) === c.expected.radiusM && JSON.stringify(best?.notes ?? []) === JSON.stringify(c.expected.notes);
        if (!same) different.push(c.id);
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} adres, ${sequenced} tanesi bina dizisiyle; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; süre ortanca ${quantile(times, 0.5).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`;
      return { outcome: different.length === 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      await address.close();
      await buildings.close();
    }
  },
};
