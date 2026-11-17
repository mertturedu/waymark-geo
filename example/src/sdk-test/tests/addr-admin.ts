import { createGeoNative } from '../../../../src/native';
import { distanceM } from '../../../../src/core/geo/distance';
import { nameKey } from '../../../../src/core/text';
import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { manifestUrlOf, sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';

type AdminCase = { id: string; text: string; kind: 'old_name' | 'district_wrong'; hood: string; expected: { status: string; point: [number, number] | null; hood: string | null; notes: string[] } };

export const sdkAddrAdmin: DeviceTest = {
  id: 'sdk.addr-admin',
  title: 'Eski mahalle adı ve yanlış ilçe örnekleri cihazda, Node ile birebir (nokta, durum, not)',
  kind: 'auto',
  async run(ctx) {
    const response = await fetch(`${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device/admin-${PLATE}.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/addr-admin-device-set.ts ${PLATE} çalıştırılmalı` };
    const cases = (await response.json()) as AdminCase[];
    const dir = sandbox('addr-admin', false);
    const geo = await createGeoNative({ manifestUrl: manifestUrlOf(ctx), publicKeys: PUBLIC_KEY ? [PUBLIC_KEY] : [], directory: dir });
    try {
      if (!geo.regions.status(PLATE).installedParts.includes('address')) {
        const checked = await geo.regions.checkUpdates();
        if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
        await geo.regions.download(PLATE, { parts: ['address'] });
      }
      const different: string[] = [];
      const right = { old_name: 0, district_wrong: 0 };
      const total = { old_name: 0, district_wrong: 0 };
      let mismatchNotes = 0;
      for (const c of cases) {
        const result = await geo.search.resolve(c.text);
        const best = result.status === 'resolved' ? result.best : result.status === 'ambiguous' ? result.candidates[0] : undefined;
        total[c.kind]++;
        if (best?.components.neighbourhood && nameKey(best.components.neighbourhood) === c.hood) right[c.kind]++;
        if (best?.notes?.includes('district_mismatch')) mismatchNotes++;
        const same = result.status === c.expected.status && (best && c.expected.point ? distanceM(best.coordinate, c.expected.point) <= 0.5 : !best && !c.expected.point) && JSON.stringify(best?.notes ?? []) === JSON.stringify(c.expected.notes);
        if (!same) different.push(c.id);
      }
      const share = (kind: 'old_name' | 'district_wrong'): string => `${Math.round((1000 * right[kind]) / Math.max(1, total[kind])) / 10}`;
      const note = `${cases.length} adres; mahalle doğru: eski ad %${share('old_name')} (${total.old_name}), yanlış ilçe %${share('district_wrong')} (${total.district_wrong}); ilçe uyumsuzluğu notu ${mismatchNotes}; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}`;
      return { outcome: different.length === 0 ? 'pass' : 'fail', value: String(cases.length - different.length), unit: 'eşleşen vaka', note };
    } finally {
      await geo.dispose();
    }
  },
};
