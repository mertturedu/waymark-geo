import type { DeviceTest } from '../../device-test/types';
import { openGeo } from '../sandbox';

export const sdkRemoveFrees: DeviceTest = {
  id: 'sdk.remove-frees',
  title: 'Silme yer açar',
  kind: 'auto',
  async run(ctx) {
    const { geo, dir } = await openGeo(ctx, 'remove', { wipe: true });
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
      const empty = dir.size ?? 0;
      await geo.regions.download('41', { parts: ['address'] });
      const used = (dir.size ?? 0) - empty;
      await geo.regions.remove('41');
      let freed = used - ((dir.size ?? 0) - empty);
      for (let i = 0; i < 10 && freed < used * 0.8; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        freed = used - ((dir.size ?? 0) - empty);
      }
      const status = geo.regions.status('41');
      if (status.state !== 'none') return { outcome: 'fail', note: `silinince durum ${status.state}` };
      if (used < 1_000_000) return { outcome: 'fail', note: `indirme yer tutmadı (${used} bayt), ölçüm geçersiz` };
      if (freed < used * 0.8) return { outcome: 'fail', note: `${(used / 1e6).toFixed(1)} MB tutulmuştu, yalnızca ${(freed / 1e6).toFixed(1)} MB açıldı` };
      return { outcome: 'pass', value: (freed / 1e6).toFixed(1), unit: 'MB açıldı', note: `${(used / 1e6).toFixed(1)} MB yer tutmuştu` };
    } finally {
      await geo.dispose();
    }
  },
};
