import type { PartKind } from '../../../../src/core';
import { createGeoNative } from '../../../../src/native';
import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { sandbox } from '../sandbox';

const MB = 1e6;
const THREE = ['16', '35', '06'];

const kinds = (parts: PartKind[]): string => parts.join('+');

export const sdkManifestMigration: DeviceTest = {
  id: 'sdk.manifest-migration',
  title: 'Eski kurulumdan yeniye geçiş: v1 ile kurulu il, manifest-v2 ile bina parçasını alır; 3 il (Bursa, İzmir, Ankara) tam iner ve aranır',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/adres-release`;
    const probe = await fetch(`${base}/manifest-v2.json`);
    if (!probe.ok) return { outcome: 'fail', note: `sürüm klasörü yok (HTTP ${probe.status}); scripts/address-release.ts çalıştırılmalı ve sunucu yeniden başlatılmalı` };
    const dir = sandbox('manifest-migration', true);
    const keys = PUBLIC_KEY ? [PUBLIC_KEY] : [];
    const geo = await createGeoNative({ manifestUrl: `${base}/manifest-v1.json`, publicKeys: keys, directory: dir });
    const notes: string[] = [];
    try {
      const checked = await geo.regions.checkUpdates();
      if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };

      await geo.regions.download('41', { parts: ['address', 'directory'] });
      const oldStyle = geo.regions.status('41').installedParts;
      if (kinds(oldStyle) !== 'address+directory') return { outcome: 'fail', note: `eski tarz kurulum beklenmedik: ${kinds(oldStyle)}` };
      const again = await geo.regions.checkUpdates();
      if (!again.ok || geo.regions.status('41').state !== 'installed') return { outcome: 'fail', note: `yeni parça var diye il güncelleme bekliyor görünüyor: ${geo.regions.status('41').state}` };
      const before = await geo.search.reverse([29.92, 40.77]);
      if (before?.building) return { outcome: 'fail', note: 'bina parçası yokken bina bilgisi geldi' };

      const started = Date.now();
      await geo.regions.download('41', { parts: ['address', 'directory', 'buildings2'] });
      const upgraded = geo.regions.status('41');
      if (!upgraded.installedParts.includes('buildings2')) return { outcome: 'fail', note: `bina parçası kurulmadı: ${kinds(upgraded.installedParts)}` };
      const after = await geo.search.reverse([29.92, 40.77]);
      if (!after?.building) return { outcome: 'fail', note: 'bina parçası kurulu ama reverse bina bulamadı' };
      notes.push(`geçiş: eski tarz ${kinds(oldStyle)} → ${kinds(upgraded.installedParts)} (${((Date.now() - started) / 1000).toFixed(1)} sn), reverse bina ${after.building.levels} kat`);

      let totalMs = 0;
      for (const id of THREE) {
        const t0 = Date.now();
        await geo.regions.download(id);
        totalMs += Date.now() - t0;
        const status = geo.regions.status(id);
        if (!status.installedParts.includes('address') || !status.installedParts.includes('buildings2')) return { outcome: 'fail', note: `${id} tam inmedi: ${kinds(status.installedParts)}` };
        notes.push(`${id} ${kinds(status.installedParts)}`);
      }
      const bursa = await geo.search.resolve('Atatürk Caddesi 1 Nilüfer');
      const izmir = await geo.search.resolve('Atatürk Caddesi 1 Konak İzmir');
      const ankara = await geo.search.resolve('Atatürk Bulvarı 1 Çankaya Ankara');
      const answered = [bursa, izmir, ankara].map((r) => r.status);
      if (answered.some((s) => s === 'region_missing' || s === 'not_found')) return { outcome: 'fail', note: `arama cevapsız: ${answered.join(',')}` };
      return { outcome: 'pass', value: (totalMs / 1000).toFixed(0), unit: 'sn (3 il)', note: `${notes.join('; ')}; arama: ${answered.join(', ')}; ${((totalMs / 1000) / THREE.length).toFixed(0)} sn/il` };
    } finally {
      await geo.dispose();
      void MB;
    }
  },
};
