import { Directory, File } from 'expo-file-system';
import { openBuildings2 } from '../../../../src/core/address/buildings2';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '67';

type Case = { id: string; point: [number, number]; kind: string; expected: string };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrRoads: DeviceTest = {
  id: 'sdk.addr-roads',
  title: 'Bina → sokak, adsız yol ve mahalle bağı: 70 bina cihazda Node ile birebir (sokak, yol, çizgi, mahalle)',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/roads.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-roads-device-set.ts çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const dir: Directory = sandbox('addr-roads', false);
    const open = createExpoOpener(dir);
    const dbs: SqlDb[] = [];
    try {
      await fetchFile(base, `roads-${PLATE}-buildings2.sqlite`, dir);
      const db: SqlDb = await open(`roads-${PLATE}-buildings2.sqlite`);
      dbs.push(db);
      const reader = await openBuildings2(db);
      const different: string[] = [];
      const times: number[] = [];
      let roadLines = 0;
      let hoods = 0;
      for (const c of cases) {
        const started = performance.now();
        const b = await reader.at(c.point, 3);
        const road = b?.road === undefined ? null : await reader.road(b.road);
        times.push(performance.now() - started);
        const got = JSON.stringify({ id: b?.id ?? null, chain: b?.chain ?? null, hood: b?.hood ?? null, road: b?.road ?? null, dist: b?.roadDistanceM ?? null, line: road ? road.line : null, roadHood: road?.hood ?? null });
        if (road) roadLines++;
        if (b?.hood !== undefined) hoods++;
        if (got !== c.expected) different.push(c.id);
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} bina, yol çizgisi okunan ${roadLines}, mahallesi olan ${hoods}; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}`;
      return { outcome: different.length === 0 && roadLines > 0 && hoods > 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      for (const d of dbs) await d.close();
    }
  },
};
