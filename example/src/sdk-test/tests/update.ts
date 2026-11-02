import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { createGeoNative } from '../../../../src/native';
import { sandbox } from '../sandbox';

const QUERY = 'Çivril Çarşı Mahallesi Kuyumcu Sokak No:3';

export const sdkUpdateKeepsLearning: DeviceTest = {
  id: 'sdk.update-keeps-learning',
  title: 'Güncelleme: v1 kurulu, v2 gelince yalnızca değişenler iner ve öğrenilen adres hâlâ doğru',
  kind: 'auto',
  async run(ctx) {
    const oldUrl = `${ctx.packServerUrl}/old/manifest-v1.json`;
    const newUrl = `${ctx.packServerUrl}/manifest-v1.json`;
    const probe = await fetch(oldUrl);
    if (!probe.ok) return { outcome: 'fail', note: `eski sürüm manifesti yok (HTTP ${probe.status}); sunucuda dist/test-data/old gerekli` };
    const dir = sandbox('update', true);
    const keys = PUBLIC_KEY ? [PUBLIC_KEY] : [];
    const first = await createGeoNative({ manifestUrl: oldUrl, publicKeys: keys, directory: dir });
    let installedBefore: string | null;
    let learnedPoint: [number, number] = [29.7352, 38.3007];
    try {
      const checked = await first.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `v1 manifesti: ${checked.code}` };
      await first.regions.download('20', { parts: ['address'] });
      installedBefore = first.regions.status('20').installedVersion;
      const found = await first.search.resolve(QUERY);
      if (found.status !== 'resolved') return { outcome: 'fail', note: `v1 ile sorgu ${found.status}` };
      const saved = await first.learn.confirm({ place: found.best, street: 'Kuyumcu Sokak', houseNumber: '3', point: learnedPoint, source: 'pin' });
      if (!saved.ok) return { outcome: 'fail', note: `öğrenme ${JSON.stringify(saved)}` };
    } finally {
      await first.dispose();
    }
    const second = await createGeoNative({ manifestUrl: newUrl, publicKeys: keys, directory: dir });
    try {
      const checked = await second.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `v2 manifesti: ${checked.code}` };
      if (!checked.updates.includes('20')) return { outcome: 'fail', note: `20 için güncelleme bulunamadı (${checked.updates.join(', ') || 'hiç'})` };
      const state = second.regions.status('20').state;
      if (state !== 'update-available') return { outcome: 'fail', note: `güncelleme öncesi durum ${state}` };
      const started = Date.now();
      await second.regions.download('20', { parts: ['address'] });
      const ms = Date.now() - started;
      const after = second.regions.status('20');
      if (after.state !== 'installed' || after.installedVersion === installedBefore) return { outcome: 'fail', note: `güncelleme sonrası durum ${after.state}, sürüm ${after.installedVersion}` };
      const again = await second.search.resolve(QUERY);
      if (again.status !== 'resolved' || again.best.source !== 'learned' || again.best.precision !== 'address') return { outcome: 'fail', note: 'öğrenilen kapı güncellemeden sonra dönmedi' };
      const [lng, lat] = again.best.coordinate;
      if (Math.abs(lng - learnedPoint[0]) > 1e-5 || Math.abs(lat - learnedPoint[1]) > 1e-5) return { outcome: 'fail', note: 'öğrenilen nokta değişti' };
      return { outcome: 'pass', value: String(ms), unit: 'ms (güncelleme indirmesi)', note: `20: ${installedBefore} -> ${after.installedVersion}; öğrenilen kapı yerinde` };
    } finally {
      await second.dispose();
    }
  },
};
