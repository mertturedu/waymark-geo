import type { DeviceTest } from '../../device-test/types';
import { openGeo } from '../sandbox';

export const sdkAutoRegion: DeviceTest = {
  id: 'sdk.auto-region',
  title: 'İl önerisi mantığı: Kadıköy, Denizli, sınır ve reddedilen öneri',
  kind: 'auto',
  async run(ctx) {
    const first = await openGeo(ctx, 'auto', { wipe: true, autoDownload: 'ask' });
    try {
      const istanbul = first.geo.regions.suggest([29.0287, 40.9903]);
      const denizli = first.geo.regions.suggest([29.0875, 37.7765]);
      const sea = first.geo.regions.suggest([25.0, 36.0]);
      if (istanbul.action !== 'suggest' || istanbul.regions[0] !== '34') return { outcome: 'fail', note: `Kadıköy için ${JSON.stringify(istanbul)}` };
      if (denizli.regions[0] !== '20') return { outcome: 'fail', note: `Denizli için ${JSON.stringify(denizli)}` };
      if (sea.action !== 'none') return { outcome: 'fail', note: `denizde ${JSON.stringify(sea)}` };
      await first.geo.regions.dismiss('20');
    } finally {
      await first.geo.dispose();
    }
    const second = await openGeo(ctx, 'auto', { wipe: false, autoDownload: 'ask' });
    try {
      const again = second.geo.regions.suggest([29.0875, 37.7765]);
      if (again.action !== 'none') return { outcome: 'fail', note: `reddedilen öneri yeniden açılışta geri geldi: ${JSON.stringify(again)}` };
      return { outcome: 'pass', note: 'öneri, ret ve ret kaydının yeniden açılışta korunması çalıştı' };
    } finally {
      await second.geo.dispose();
    }
  },
};
