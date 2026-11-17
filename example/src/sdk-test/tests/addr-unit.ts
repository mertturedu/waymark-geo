import { Directory, File } from 'expo-file-system';
import { openBuildings2 } from '../../../../src/core/address/buildings2';
import { createSearch } from '../../../../src/core/address/search';
import { formatUnit } from '../../../../src/core/address/unit';
import { distanceM } from '../../../../src/core/geo/distance';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { Lang } from '../../../../src/core/text/types';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';
const LANGS: Lang[] = ['tr', 'en', 'de', 'ar', 'ru', 'el'];

type Case = { id: string; text: string; expected: { status: string; point: [number, number] | null; unit: unknown; formatted: string[] } };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrUnit: DeviceTest = {
  id: 'sdk.addr-unit',
  title: 'Bina içi: blok, kat, daire ve notlar 50 adreste Node ile birebir, altı dilde gösterim ve hız',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/unit-${PLATE}.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-unit-device-set.ts ${PLATE} çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const dir: Directory = sandbox('addr-unit', false);
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
      let withUnit = 0;
      let withBlock = 0;
      for (const c of cases) {
        const started = performance.now();
        const result = await search.resolve(c.text);
        times.push(performance.now() - started);
        named.push({ id: c.id, ms: times[times.length - 1] as number });
        const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
        if (best?.unit) withUnit++;
        if (best?.unit?.block?.building != null) withBlock++;
        const samePoint = best && c.expected.point ? distanceM(best.coordinate, c.expected.point) <= 0.5 : !best && !c.expected.point;
        const formatted = best?.unit ? LANGS.map((l) => formatUnit(best.unit as NonNullable<typeof best.unit>, l)) : [];
        const same = result.status === c.expected.status && samePoint && JSON.stringify(best?.unit ?? null) === JSON.stringify(c.expected.unit) && JSON.stringify(formatted) === JSON.stringify(c.expected.formatted);
        if (!same) different.push(c.id);
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} adres, ${withUnit} tanesi birimle, ${withBlock} tanesinde blok bulundu; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; süre ortanca ${quantile(times, 0.5).toFixed(0)} ms, p95 ${p95.toFixed(0)} ms; en yavaş ${named.sort((a, b) => b.ms - a.ms).slice(0, 4).map((n) => `${n.id}:${n.ms.toFixed(0)}`).join(' ')}`;
      return { outcome: different.length === 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      await address.close();
      await buildings.close();
    }
  },
};
