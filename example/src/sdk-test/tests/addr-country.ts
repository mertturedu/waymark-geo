import { Directory, File } from 'expo-file-system';
import { createSearch } from '../../../../src/core/address/search';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { SqlDb } from '../../../../src/core/ports';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '16';

type Set = { plate: string; queries: { id: string; text: string; expected: string }[]; lookups: { sid: string; expected: string }[]; admin: { query: Record<string, string>; expected: string }[] };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

export const sdkAddrCountry: DeviceTest = {
  id: 'sdk.addr-country',
  title: 'Ülke temeli (kapı ve işletme olmadan sokak dizini): 80 sorgu, kimlik çözme ve gezinme cihazda Node ile birebir',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/country.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-country-device-set.ts çalıştırılmalı` };
    const set = (await response.json()) as Set;
    const dir: Directory = sandbox('addr-country', false);
    const open = createExpoOpener(dir);
    const dbs: SqlDb[] = [];
    try {
      await fetchFile(base, `country-${set.plate}-address.sqlite`, dir);
      const address: SqlDb = await open(`country-${set.plate}-address.sqlite`);
      dbs.push(address);
      const search = createSearch({ store: { installed: async () => [set.plate], open: async () => address, openPart: async () => null }, borders: embeddedBorders() });
      await search.warm(set.plate);
      const different: string[] = [];
      const times: number[] = [];
      let streets = 0;
      for (const c of set.queries) {
        const started = performance.now();
        const result = await search.resolve(c.text, { limit: 5 });
        times.push(performance.now() - started);
        const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
        if (top[0]?.precision === 'street') streets++;
        const got = JSON.stringify({ status: result.status, top: top.map((p) => ({ id: p.id, sid: p.sid ?? null, point: p.coordinate, precision: p.precision })) });
        if (got !== c.expected) different.push(c.id);
      }
      let resolved = 0;
      for (const l of set.lookups) {
        const got = JSON.stringify(await search.lookup(l.sid));
        if (got !== l.expected) different.push(`kimlik-${l.sid}`);
        else resolved++;
      }
      let navigated = 0;
      for (const a of set.admin) {
        const got = JSON.stringify(await search.admin(a.query));
        if (got !== a.expected) different.push(`gezinme-${JSON.stringify(a.query)}`);
        else navigated++;
      }
      const p95 = quantile(times, 0.95);
      const total = set.queries.length + set.lookups.length + set.admin.length;
      const note = `${set.queries.length} sorgu (${streets} tanesi sokak düzeyinde), ${set.lookups.length} kimlik, ${set.admin.length} gezinme; Node ile eşlik ${total - different.length}/${total}${different.length > 0 ? ` (farklı: ${different.slice(0, 4).join(', ')})` : ''}`;
      return { outcome: different.length === 0 && streets > 0 && resolved > 0 && navigated > 0 ? 'pass' : 'fail', value: p95.toFixed(0), unit: 'ms (p95)', note };
    } finally {
      for (const db of dbs) await db.close();
    }
  },
};
