import { Directory, File } from 'expo-file-system';
import { createSearch } from '../../../../src/core/address/search';
import { distanceM } from '../../../../src/core/geo/distance';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';
const NAMED_RADIUS_M = 80;

type StreetCase = { id: string; text: string; kind: 'named_by_business' | 'plain'; truth: [number, number]; expected: { status: string; point: [number, number] | null; street: string | null } };

export const sdkAddrStreets: DeviceTest = {
  id: 'sdk.addr-streets',
  title: 'Sokak adları: işletme adreslerinden adlandırılan yollar cihazda bulunuyor, Node ile birebir',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const response = await fetch(`${base}/streets-${PLATE}.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/addr-streets-device-set.ts ${PLATE} çalıştırılmalı` };
    const cases = (await response.json()) as StreetCase[];
    const dir: Directory = sandbox('addr-streets', false);
    const file = new File(dir, 'address.sqlite');
    if (!file.exists) await File.downloadFileAsync(`${base}/streets-${PLATE}.sqlite`, file);
    const open = createExpoOpener(dir);
    const search = createSearch({ store: { installed: async () => [PLATE], open: async () => open('address.sqlite') }, borders: embeddedBorders() });
    const different: string[] = [];
    const named = { total: 0, found: 0 };
    for (const c of cases) {
      const result = await search.resolve(c.text);
      const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
      if (c.kind === 'named_by_business') {
        named.total++;
        if (best && distanceM(best.coordinate, c.truth) <= NAMED_RADIUS_M) named.found++;
      }
      const same = result.status === c.expected.status && (best && c.expected.point ? distanceM(best.coordinate, c.expected.point) <= 0.5 : !best && !c.expected.point);
      if (!same) different.push(c.id);
    }
    const share = Math.round((1000 * named.found) / Math.max(1, named.total)) / 10;
    const note = `${cases.length} adres; adı işletmelerden öğrenilen ${named.total} yolun %${share}'i ${NAMED_RADIUS_M} m içinde bulundu; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}`;
    return { outcome: different.length === 0 ? 'pass' : 'fail', value: String(share), unit: '% bulundu', note };
  },
};
