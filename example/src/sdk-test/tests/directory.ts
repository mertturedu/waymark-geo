import type { DeviceTest } from '../../device-test/types';
import { openGeo } from '../sandbox';

const CIVRIL: [number, number] = [29.7366, 38.3006];
const BUSINESS = 'Çivril Elit Otel';
const STREET = 'Çivril Çarşı Mahallesi Kadir Kameroğlu Caddesi No:5';

export const sdkDirectory: DeviceTest = {
  id: 'sdk.directory',
  title: 'İşletme rehberi: Çivril işletmesi adıyla, rehberden gelen kapı ve kapsam sayısı',
  kind: 'auto',
  async run(ctx) {
    const { geo } = await openGeo(ctx, 'directory', { wipe: true });
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
      await geo.regions.download('20', { parts: ['address', 'directory'] });
      const named = await geo.search.resolve(BUSINESS);
      const hit = named.status === 'resolved' ? named.best : named.status === 'region_missing' ? null : named.candidates[0];
      if (hit?.source !== 'overture' || hit.precision !== 'poi') return { outcome: 'fail', note: `işletme rehberden gelmedi: ${hit?.label} (${hit?.source}, ${hit?.precision})` };
      if (!hit.details?.category || !hit.components.houseNumber) return { outcome: 'fail', note: `işletme ayrıntısı eksik: ${hit.label} (${JSON.stringify(hit.details)})` };
      const street = await geo.search.resolve(STREET);
      const door = street.status === 'region_missing' ? null : (street.status === 'resolved' ? street.best : street.candidates[0]);
      if (!door || !door.approximate || door.components.street !== 'Kadir Kameroğlu Caddesi') return { outcome: 'fail', note: `rehber sokağı dönmedi: ${door?.label}` };
      const coverage = await geo.search.coverage(CIVRIL);
      if (!coverage || coverage.addresses < 100) return { outcome: 'fail', note: `kapsam rehberi saymıyor: ${JSON.stringify(coverage)}` };
      return { outcome: 'pass', note: `${hit.label} [${hit.details.category}]; sokak ${door.label} (${door.precision}); Çivril ${coverage.addresses} kapı` };
    } finally {
      await geo.dispose();
    }
  },
};
