import { createGeoNative } from '../../../../src/native';
import type { PartKind } from '../../../../src/core';
import type { DeviceTest } from '../../device-test/types';
import { PUBLIC_KEY } from '../../sdk/server';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const WANTED: PartKind[] = ['address', 'buildings', 'directory', 'buildings2', 'learned'];

type OnlineSet = { plate: string; city: string; key: string; port: number; texts: string[] };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

export const sdkAddrOnline: DeviceTest = {
  id: 'sdk.addr-online',
  title: 'Çevrimiçi yedek: il kurulu değilken arama sunucudan gelir, il kurulunca telefonda çözülen sonuçla aynıdır',
  kind: 'auto',
  async run(ctx) {
    const response = await fetch(`${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device/online.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-online-device-set.ts çalıştırılmalı` };
    const set = (await response.json()) as OnlineSet;
    const host = new URL(ctx.packServerUrl);
    const baseUrl = `http://${host.hostname}:${set.port}`;
    const manifestUrl = `${ctx.packServerUrl}/adres-release/manifest-v1.json`;
    const keys = PUBLIC_KEY ? [PUBLIC_KEY] : [];
    const online = await createGeoNative({ manifestUrl, publicKeys: keys, directory: sandbox('addr-online-a', true), online: { baseUrl, key: set.key } });
    const offline = await createGeoNative({ manifestUrl, publicKeys: keys, directory: sandbox('addr-online-b', true) });
    try {
      for (const geo of [online, offline]) {
        const checked = await geo.regions.checkUpdates();
        if (!checked.ok) return { outcome: 'fail', note: `manifest: ${checked.code}` };
      }
      const hints = { hints: { city: set.city } };
      const missing = await online.search.resolve(set.texts[0] as string, hints);
      if (missing.status === 'region_missing') return { outcome: 'fail', note: 'sunucuya ulaşılamadı: il kurulu değilken cevap gelmedi' };
      const parts = (offline.regions.list().find((r) => r.id === set.plate)?.files.map((f) => f.kind) ?? []).filter((k): k is PartKind => (WANTED as string[]).includes(k));
      await offline.regions.download(set.plate, { parts });
      const times: number[] = [];
      const different: number[] = [];
      let found = 0;
      for (const [i, text] of set.texts.entries()) {
        const started = performance.now();
        const asked = await online.search.resolve(text, hints);
        times.push(performance.now() - started);
        const local = await offline.search.resolve(text, hints);
        if (asked.status !== 'region_missing' && asked.status !== 'not_found') found++;
        if (JSON.stringify(asked) !== JSON.stringify(local)) different.push(i);
      }
      const note = `${set.texts.length} sorgu (${set.plate} ili, parçalar ${parts.join('+')}); sunucudan cevap ${found}; telefonda çözülenle eşlik ${set.texts.length - different.length}/${set.texts.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}; sunucu süresi ortanca ${quantile(times, 0.5).toFixed(0)} ms, p95 ${quantile(times, 0.95).toFixed(0)} ms`;
      return { outcome: different.length === 0 && found > 0 ? 'pass' : 'fail', value: quantile(times, 0.95).toFixed(0), unit: 'ms (p95, ağ dahil)', note };
    } finally {
      await online.dispose();
      await offline.dispose();
    }
  },
};
