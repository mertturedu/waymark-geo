import { Paths } from 'expo-file-system';
import golden from '../../../../fixtures/address-golden/34.json';
import type { DeviceTest } from '../../device-test/types';
import { openGeo } from '../sandbox';

const QUERY = (golden as { queries: { text: string }[] }).queries[0]?.text ?? '';

export const sdkPackInstall: DeviceTest = {
  id: 'sdk.pack-install',
  title: 'İndirme: İstanbul adres paketi, doğrulama ve ilk arama',
  kind: 'auto',
  async run(ctx) {
    const { geo } = await openGeo(ctx, 'install', { wipe: true });
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
      const before = Paths.availableDiskSpace;
      const started = performance.now();
      await geo.regions.download('34', { parts: ['address'] });
      const seconds = (performance.now() - started) / 1000;
      const status = geo.regions.status('34');
      if (status.state !== 'installed' || !status.installedParts.includes('address')) return { outcome: 'fail', note: `durum ${status.state}` };
      const mb = (before - Paths.availableDiskSpace) / 1_000_000;
      const result = await geo.search.resolve(QUERY, { hints: { city: 'İstanbul' } });
      if (result.status !== 'resolved' && result.status !== 'ambiguous') return { outcome: 'fail', note: `arama sonucu ${result.status}` };
      return { outcome: 'pass', value: seconds.toFixed(1), unit: 'sn', note: `${mb.toFixed(1)} MB yer tuttu, SHA-256 ve imza doğrulandı, ilk arama ${result.status}` };
    } finally {
      await geo.dispose();
    }
  },
};
