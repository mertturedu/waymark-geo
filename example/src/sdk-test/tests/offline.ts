import * as Network from 'expo-network';
import type { DeviceTest, TestResult } from '../../device-test/types';
import { ADDRESS_TESTS, sdkOfflineSearch } from './address';
import { LEARN_TESTS } from './learn-more';
import { MAP_TESTS } from './map-tour';
import { ROTATION_TESTS } from './rotation';
import { SIM_TESTS } from './simulation';
import { ICON_TESTS } from './map-icons';
import { PLAN_TESTS } from './plan';
import { ROUTE_TESTS } from './route';
import { sdkSearchSpeed } from './search-speed';
import { sdkRegionDetect } from './region-detect';
import { ensureIstanbul } from '../sandbox';

const SKIPPED = new Set(['sdk.offline-search', 'sdk.route-install']);

async function offlineGate(): Promise<TestResult | null> {
  const state = await Network.getNetworkStateAsync();
  if (!state.isConnected) return null;
  return { outcome: 'fail', note: `ağ açık (${String(state.type)}): uçak modunu aç, Wi-Fi'ı kapat, sonra yeniden dene` };
}

function spyFetch(): { calls: string[]; restore(): void } {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const text = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push(text.replace(/[?#].*$/, ''));
    return original(input, init);
  }) as typeof fetch;
  return { calls, restore: () => void (globalThis.fetch = original) };
}

const offlineId = (id: string): string => `off.${id.replace(/^sdk\./, '')}`;

function offline(inner: DeviceTest): DeviceTest {
  return {
    id: offlineId(inner.id),
    title: `Uçak modu: ${inner.title}`,
    kind: 'auto',
    async run(ctx) {
      const blocked = await offlineGate();
      if (blocked) return blocked;
      const spy = spyFetch();
      try {
        const result = await inner.run(ctx);
        if (spy.calls.length > 0) return { ...result, outcome: 'fail', note: `${spy.calls.length} ağ isteği denendi (${[...new Set(spy.calls)].slice(0, 3).join(', ')}); ${result.note ?? ''}`.trim() };
        return { ...result, note: `${result.note ?? ''}${result.note ? '; ' : ''}ağ isteği 0` };
      } finally {
        spy.restore();
      }
    },
  };
}

const test = (id: string, title: string, run: DeviceTest['run']): DeviceTest => ({ id, title, kind: 'auto', run });

export const offNetworkClosed = test('off.network-closed', 'Uçak modu: ağ tamamen kapalı', async () => {
  const state = await Network.getNetworkStateAsync();
  const detail = `bağlı ${String(state.isConnected)}, internet ${String(state.isInternetReachable)}, tür ${String(state.type)}`;
  return state.isConnected ? { outcome: 'fail', note: `ağ açık: ${detail}` } : { outcome: 'pass', note: detail };
});

export const offUpdateCheck = test('off.update-check', 'Uçak modu: güncelleme kontrolü hata verir ya da sınırlanır, hiçbir şeyi bozmaz, arama sürer', async (ctx) => {
  const blocked = await offlineGate();
  if (blocked) return blocked;
  const { geo } = await ensureIstanbul(ctx);
  try {
    const before = geo.regions.installed().join(',');
    const first = await geo.regions.checkUpdates();
    const second = await geo.regions.checkUpdates({ minIntervalMs: 3_600_000 });
    if (first.ok) return { outcome: 'fail', note: `ağsız kontrol başarılı döndü: ${JSON.stringify(first)}` };
    if (first.code !== 'network') return { outcome: 'fail', note: `beklenen network, gelen ${first.code}` };
    const throttled = second.ok && second.skipped === true;
    if (second.ok && !throttled) return { outcome: 'fail', note: `ağsız ikinci kontrol başarılı döndü: ${JSON.stringify(second)}` };
    if (!second.ok && second.code !== 'network') return { outcome: 'fail', note: `ikinci kontrol network yerine ${second.code} verdi` };
    if (geo.regions.installed().join(',') !== before) return { outcome: 'fail', note: 'kurulu bölge listesi değişti' };
    const found = await geo.search.resolve('Kadıköy Caferağa Mahallesi Moda Caddesi', { hints: { city: 'İstanbul' } });
    return { outcome: found.status === 'resolved' || found.status === 'ambiguous' ? 'pass' : 'fail', note: `hata kodu ${first.code}; saatlik sınırlı ikinci kontrol ${throttled ? 'son başarılı kontrolden beri atlandı' : 'network hatası verdi'}; kontrolden sonra arama ${found.status}` };
  } finally {
    await geo.dispose();
  }
});

export const offDownloadClean = test('off.download-clean', 'Uçak modu: yeni il indirmesi başarısız olur, yarım dosya ve kayıt bırakmaz', async (ctx) => {
  const blocked = await offlineGate();
  if (blocked) return blocked;
  const { geo } = await ensureIstanbul(ctx);
  try {
    const before = geo.regions.installed().join(',');
    if (geo.regions.status('06').installedParts.length > 0) return { outcome: 'fail', note: '06 zaten kurulu, test geçersiz' };
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 40_000));
    const attempt = geo.regions.download('06', { parts: ['address'] }).then(() => 'ok' as const, () => 'failed' as const);
    const outcome = await Promise.race([attempt, timeout]);
    if (outcome === 'ok') return { outcome: 'fail', note: 'ağsız indirme başarılı göründü' };
    if (outcome === 'timeout') return { outcome: 'fail', note: 'ağsız indirme 40 sn içinde hata vermedi' };
    const after = geo.regions.status('06');
    if (after.installedParts.length > 0) return { outcome: 'fail', note: `yarım kurulum: ${after.installedParts.join(', ')}` };
    await geo.regions.remove('06');
    if (geo.regions.installed().join(',') !== before) return { outcome: 'fail', note: 'kurulu bölge listesi değişti' };
    return { outcome: 'pass', note: `indirme hata verdi (durum ${after.state}), kurulu listesi aynı: ${before}` };
  } finally {
    await geo.dispose();
  }
});

export const offStyleLocal = test('off.style-local', 'Uçak modu: harita stilinde hiç uzak adres yok (yazı tipi, simge ve karolar yerel)', async (ctx) => {
  const { geo } = await ensureIstanbul(ctx);
  try {
    const remote = new Set<string>();
    for (const theme of ['light', 'dark'] as const) {
      const text = JSON.stringify(geo.map.style({ theme }));
      for (const match of text.matchAll(/https?:\/\/[^"\s]+/g)) remote.add(match[0].slice(0, 60));
    }
    return remote.size === 0 ? { outcome: 'pass', note: 'açık ve koyu stilde http(s) adresi yok' } : { outcome: 'fail', note: `uzak adres: ${[...remote].slice(0, 3).join(', ')}` };
  } finally {
    await geo.dispose();
  }
});

const wrap = (tests: DeviceTest[]): DeviceTest[] => tests.filter((t) => !SKIPPED.has(t.id)).map(offline);

export const OFFLINE_TESTS: DeviceTest[] = [
  offNetworkClosed,
  offStyleLocal,
  offUpdateCheck,
  offDownloadClean,
  ...wrap([sdkRegionDetect]),
  ...wrap(ADDRESS_TESTS.filter((t) => t !== sdkOfflineSearch)),
  ...wrap(ROUTE_TESTS),
  ...wrap(PLAN_TESTS),
  ...wrap(LEARN_TESTS),
  ...wrap([sdkSearchSpeed]),
  ...wrap(MAP_TESTS),
  ...wrap(ROTATION_TESTS),
  ...wrap(SIM_TESTS),
  ...wrap(ICON_TESTS),
];
