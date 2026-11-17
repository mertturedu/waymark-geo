import { Directory, File } from 'expo-file-system';
import { openBuildings2 } from '../../../../src/core/address/buildings2';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';


type Case = { id: string; point: [number, number]; kind: string; expected: string };
type Set = { plate: string; buildings: Case[]; ranges: { chain: number; expected: string }[] };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrNumbers: DeviceTest = {
  id: 'sdk.addr-numbers',
  title: 'Bina numarası (bilinen, tahmini) ve sokak-taraf aralığı cihazda Node ile birebir',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/numbers.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-numbers-device-set.ts çalıştırılmalı` };
    const set = (await response.json()) as Set;
    const dir: Directory = sandbox('addr-numbers', false);
    const open = createExpoOpener(dir);
    const dbs: SqlDb[] = [];
    try {
      await fetchFile(base, `numbers-${set.plate}-buildings2.sqlite`, dir);
      const db: SqlDb = await open(`numbers-${set.plate}-buildings2.sqlite`);
      dbs.push(db);
      const reader = await openBuildings2(db);
      const different: string[] = [];
      const times: number[] = [];
      let known = 0;
      let predicted = 0;
      for (const c of set.buildings) {
        const started = performance.now();
        const b = await reader.at(c.point, 3);
        times.push(performance.now() - started);
        if (b?.knownNumber !== undefined) known++;
        if (b?.predictedNumber !== undefined) predicted++;
        const got = JSON.stringify({ id: b?.id ?? null, known: b?.knownNumber ?? null, source: b?.knownSource ?? null, predicted: b?.predictedNumber ?? null });
        if (got !== c.expected) different.push(c.id);
      }
      let ranges = 0;
      for (const r of set.ranges) {
        const got = JSON.stringify(await reader.ranges(r.chain));
        if (got !== r.expected) different.push(`aralık-${r.chain}`);
        else ranges++;
      }
      const p95 = quantile(times, 0.95);
      const total = set.buildings.length + set.ranges.length;
      const note = `${set.buildings.length} bina (bilinen numaralı ${known}, tahmini ${predicted}), ${set.ranges.length} sokak aralığı; Node ile eşlik ${total - different.length}/${total}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}`;
      return { outcome: different.length === 0 && known > 0 && predicted > 0 && ranges > 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      for (const d of dbs) await d.close();
    }
  },
};
