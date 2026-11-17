import { Directory, File } from 'expo-file-system';
import { openBuildings2 } from '../../../../src/core/address/buildings2';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';

type Case = { kind: 'at' | 'near' | 'street'; point?: [number, number]; chain?: number; side?: 'left' | 'right'; expected: unknown };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

export const sdkAddrBuildings: DeviceTest = {
  id: 'sdk.addr-buildings',
  title: 'Bina katmanı v2: Kadıköy çevresi (20 bin bina) nokta, yakın, sokak sırası sorguları Node ile birebir',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/buildings2-${PLATE}.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-building-device-set.ts ${PLATE} çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const dir: Directory = sandbox('addr-buildings', false);
    const file = new File(dir, 'buildings2.sqlite');
    if (file.exists) file.delete();
    await File.downloadFileAsync(`${base}/buildings2-${PLATE}.sqlite`, file);
    const db = await createExpoOpener(dir)('buildings2.sqlite');
    try {
      const opened = performance.now();
      const reader = await openBuildings2(db);
      const openMs = performance.now() - opened;
      const different: string[] = [];
      const atTimes: number[] = [];
      let hits = 0;
      let atCases = 0;
      let index = 0;
      for (const c of cases) {
        index++;
        let got: unknown;
        if (c.kind === 'at') {
          const started = performance.now();
          const b = await reader.at(c.point as [number, number]);
          atTimes.push(performance.now() - started);
          atCases++;
          if (b) hits++;
          got = b ? { gid: b.gid, levels: b.levels, chain: b.chain, side: b.side, sequence: b.sequence } : null;
        } else if (c.kind === 'near') {
          got = (await reader.near(c.point as [number, number], 40, 5)).map((n) => n.building.gid);
        } else {
          got = (await reader.ofStreet(c.chain as number, c.side)).map((b) => [b.gid, b.sequence]);
        }
        if (JSON.stringify(got) !== JSON.stringify(c.expected)) different.push(`${c.kind}#${index}`);
      }
      const p95 = quantile(atTimes, 0.95);
      const note = `${cases.length} sorgu; ${atCases} noktanın ${hits}'inde bina bulundu; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; açılış ${openMs.toFixed(1)} ms, nokta sorgusu ortanca ${quantile(atTimes, 0.5).toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`;
      return { outcome: different.length === 0 ? 'pass' : 'fail', value: p95.toFixed(1), unit: 'ms (p95)', note };
    } finally {
      await db.close();
    }
  },
};
