import type { DeviceTest } from '../../device-test/types';
import { createExpoLearnStore } from '../../../../src/native';
import { openGeo } from '../sandbox';

const QUERY = 'Çivril Çarşı Mahallesi Kuyumcu Sokak No:3';
const CIVRIL: [number, number] = [29.7366, 38.3006];

export const sdkSparseArea: DeviceTest = {
  id: 'sdk.sparse-area',
  title: 'Verisi az ilçe: Çivril, mahalle yedeği, uyarı ve sokak öğrenme',
  kind: 'auto',
  async run(ctx) {
    const { geo, dir } = await openGeo(ctx, 'sparse', { wipe: true });
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
      await geo.regions.download('20', { parts: ['address'] });
      const first = await geo.search.resolve(QUERY);
      if (first.status !== 'resolved') return { outcome: 'fail', note: `Çivril sokağı için durum ${first.status}` };
      const area = first.best;
      if (area.precision !== 'neighbourhood' || !area.approximate || area.components.district !== 'Çivril') return { outcome: 'fail', note: `mahalle yedeği gelmedi: ${area.label} (${area.precision})` };
      const wrongDistrict = await geo.search.resolve('Çivril Çarşı Mahallesi Atatürk Caddesi 12');
      const other = wrongDistrict.status === 'resolved' ? wrongDistrict.best : wrongDistrict.status === 'region_missing' ? null : wrongDistrict.candidates[0];
      if (other?.components.district !== 'Çivril') return { outcome: 'fail', note: `başka ilçe döndü: ${other?.label}` };
      const coverage = await geo.search.coverage(CIVRIL);
      if (coverage?.district !== 'Çivril' || coverage.level !== 'sparse') return { outcome: 'fail', note: `kapsam ${JSON.stringify(coverage)}` };
      const hoods = await geo.search.hoods();
      if (!hoods.some((h) => h.name === 'Çarşı')) return { outcome: 'fail', note: `mahalle etiketleri arasında Çarşı yok (${hoods.length} etiket)` };
      const point: [number, number] = [29.7352, 38.3007];
      const learned = await geo.learn.confirm({ place: area, street: 'Kuyumcu Sokak', houseNumber: '3', point, source: 'pin' });
      if (!learned.ok) {
        const cause = await createExpoLearnStore(dir, 'probe.sqlite').write('probe', '1').then(() => 'yeni dosyaya yazma çalışıyor', (error: unknown) => String(error));
        return { outcome: 'fail', note: `öğrenme ${JSON.stringify(learned)}; ${cause}` };
      }
      const again = await geo.search.resolve(QUERY);
      if (again.status !== 'resolved' || again.best.source !== 'learned' || again.best.precision !== 'address') return { outcome: 'fail', note: 'öğrenilen kapı sorguda dönmedi' };
      return { outcome: 'pass', note: `Çivril: ${coverage.streets} sokak, ${coverage.addresses} kapı (az); ${hoods.length} mahalle etiketi; yedek ${area.label}; öğrenilen kapı geri geldi` };
    } finally {
      await geo.dispose();
    }
  },
};
