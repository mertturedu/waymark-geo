import type { DeviceTest } from '../../device-test/types';
import { openGeo } from '../sandbox';

export const sdkRegionMissing: DeviceTest = {
  id: 'sdk.region-missing',
  title: 'Başka ilde arama: önce region_missing, yalnızca adres paketiyle sonuç',
  kind: 'auto',
  async run(ctx) {
    const { geo } = await openGeo(ctx, 'missing', { wipe: true });
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
      const before = await geo.search.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' } });
      if (before.status !== 'region_missing' || !before.regions.includes('34')) return { outcome: 'fail', note: `paket yokken sonuç ${before.status}` };
      await geo.regions.download('34', { parts: ['address'] });
      const after = await geo.search.resolve('Bahariye Caddesi 14 Kadıköy', { hints: { city: 'İstanbul' } });
      if (after.status === 'region_missing' || after.status === 'not_found') return { outcome: 'fail', note: `adres paketinden sonra sonuç ${after.status}` };
      const status = geo.regions.status('34');
      if (status.installedParts.join() !== 'address' || geo.regions.baseDir() !== null) return { outcome: 'fail', note: `fazladan parça indi: ${status.installedParts.join()} / ${geo.regions.baseDir()}` };
      return { outcome: 'pass', note: 'harita ve temel paket inmedi' };
    } finally {
      await geo.dispose();
    }
  },
};
