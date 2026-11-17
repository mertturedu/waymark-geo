import type { Manifest } from '../../../../src/core/region/manifest';
import { MLT_SUFFIX } from '../../../../src/core/region/manifest';
import { createZstdDecode } from '../../../../src/core/packs/zstd';
import type { DeviceTest, TestContext } from '../../device-test/types';
import { openGeo, MAIN } from '../sandbox';
import { BUILDINGS, count, KADIKOY, LABELS, REGION_FEATURES, ROADS, settle, test, withTour } from './map-tour';

const REGION = '34';
const ZOOMS = [16, 17];
const ROUTE_VERSION_AT = 4;
const MIN_BUILDINGS = 5;
const CITIES: { id: string; name: string; at: [number, number] }[] = [
  { id: '06', name: 'Ankara', at: [32.8541, 39.9208] },
  { id: '35', name: 'İzmir', at: [27.1428, 38.435] },
  { id: '16', name: 'Bursa', at: [29.061, 40.1826] },
  { id: '07', name: 'Antalya', at: [30.7133, 36.8841] },
];
const CITY_ROUTES: Record<string, { from: [number, number]; to: [number, number]; minKm: number; maxKm: number }> = {
  '06': { from: [32.8541, 39.9208], to: [32.7597, 39.9005], minKm: 3, maxKm: 20 },
  '35': { from: [27.1286, 38.4189], to: [27.1428, 38.435], minKm: 1, maxKm: 15 },
  '16': { from: [29.061, 40.1826], to: [29.0233, 40.2186], minKm: 2, maxKm: 20 },
  '07': { from: [30.7133, 36.8841], to: [30.6459, 36.8969], minKm: 3, maxKm: 20 },
};
const ZSTD_CITIES = ['16', '06', '35'];

async function routeVersion(base: string, path: string): Promise<number | null> {
  const response = await fetch(`${base}/${path}`, { headers: { Range: 'bytes=0-5' } });
  if (!response.ok) return null;
  const head = new Uint8Array(await response.arrayBuffer());
  return head.length >= ROUTE_VERSION_AT + 2 ? (head[ROUTE_VERSION_AT] as number) | ((head[ROUTE_VERSION_AT + 1] as number) << 8) : null;
}

export const sdkMapFormat: DeviceTest = test('sdk.map-format', 'Paket biçimi: İstanbul karo biçimi (MVT ya da MLT) ve rota sürümü okunur, Kadıköy yol, bina ve yazı çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    const manifest = (await (await fetch(`${ctx.packServerUrl}/manifest-v1.json`)).json()) as Manifest;
    const files = manifest.regions.find((region) => region.id === REGION)?.files ?? [];
    const tiles = files.find((file) => file.kind === 'tiles');
    const places = files.find((file) => file.kind === 'places');
    const route = files.find((file) => file.kind === 'route');
    if (!tiles) return { outcome: 'fail', note: 'manifestte İstanbul karo dosyası yok' };
    const format = tiles.path.endsWith(MLT_SUFFIX) ? 'MLT' : 'MVT';
    const placesFormat = places ? (places.path.endsWith(MLT_SUFFIX) ? 'MLT' : 'MVT') : '-';
    const version = route ? await routeVersion(ctx.packServerUrl, route.path) : null;
    const lines: string[] = [];
    for (const zoom of ZOOMS) {
      tour.say(`Kadıköy zoom ${zoom}`);
      await tour.go({ center: KADIKOY, zoom }, 'jump');
      const roads = (await settle(tour, ROADS, REGION_FEATURES)).length;
      const buildings = (await settle(tour, BUILDINGS, REGION_FEATURES)).length;
      const labels = await count(tour, LABELS);
      lines.push(`z${zoom}: yol ${roads}, bina ${buildings}, yazı ${labels}`);
      if (roads < REGION_FEATURES || buildings < REGION_FEATURES) return { outcome: 'fail', note: `${format} karolar yeterince çizilmedi: ${lines.join('; ')}` };
    }
    return { outcome: 'pass', value: format, note: `karo ${format}, işletme ${placesFormat}, rota v${version ?? '?'}, minSdk ${manifest.minSdk}; ${lines.join('; ')}` };
  }),
);

type Part = 'address' | 'tiles' | 'places' | 'route';

async function install(ctx: TestContext, ids: string[], parts: Part[]): Promise<void> {
  const { geo } = await openGeo(ctx, MAIN, { wipe: false });
  try {
    const checked = await geo.regions.checkUpdates();
    for (const id of ids) {
      const have = geo.regions.status(id).installedParts;
      const lacking = parts.filter((part) => !have.includes(part));
      if (lacking.length === 0) continue;
      if (!checked.ok) throw new Error(`${id} paketi eksik ve manifest alınamadı: ${checked.code}`);
      await geo.regions.download(id, { parts: [...have, ...lacking] });
    }
  } finally {
    await geo.dispose();
  }
}

async function manifestOf(ctx: TestContext): Promise<Manifest> {
  return (await (await fetch(`${ctx.packServerUrl}/manifest-v1.json`)).json()) as Manifest;
}

export const sdkFormatAll: DeviceTest = test('sdk.fmt-manifest', 'Paket biçimi: 81 ilin karo ve işletme dosyaları aynı biçimde, rota dosyaları sürüm 2', async (ctx) => {
  const manifest = await manifestOf(ctx);
  const formats = new Map<string, number>();
  const versions = new Map<string, number>();
  const odd: string[] = [];
  for (const region of manifest.regions) {
    for (const file of region.files) {
      if (file.kind !== 'tiles' && file.kind !== 'places') continue;
      const format = file.path.endsWith(MLT_SUFFIX) ? 'MLT' : 'MVT';
      formats.set(`${file.kind} ${format}`, (formats.get(`${file.kind} ${format}`) ?? 0) + 1);
    }
    const route = region.files.find((file) => file.kind === 'route');
    if (!route) {
      odd.push(`${region.id}: rota yok`);
      continue;
    }
    const version = await routeVersion(ctx.packServerUrl, route.path);
    versions.set(`v${version ?? '?'}`, (versions.get(`v${version ?? '?'}`) ?? 0) + 1);
  }
  const summary = [...formats, ...versions].map(([key, n]) => `${key} ${n}`).join(', ');
  const mixed = new Set([...formats.keys()].map((key) => key.split(' ')[1])).size > 1;
  if (manifest.regions.length !== 81) return { outcome: 'fail', note: `${manifest.regions.length} il; ${summary}` };
  if (mixed) return { outcome: 'fail', note: `karma biçim: ${summary}` };
  if (odd.length > 0 || versions.size !== 1 || !versions.has('v2')) return { outcome: 'fail', note: `${summary}; ${odd.join(', ')}` };
  return { outcome: 'pass', note: `${summary}; minSdk ${manifest.minSdk}` };
});

export const sdkFormatCities: DeviceTest = test('sdk.fmt-cities', 'Paket biçimi: Ankara, İzmir, Bursa ve Antalya z15 ve z17 yol, bina ve yazı çizer', async (ctx) => {
  await install(ctx, CITIES.map((city) => city.id), ['address', 'tiles', 'places']);
  return withTour(ctx, async (tour) => {
    const lines: string[] = [];
    for (const city of CITIES) {
      for (const zoom of [15, 17]) {
        tour.say(`${city.name} zoom ${zoom}`);
        await tour.go({ center: city.at, zoom }, 'jump');
        const roads = (await settle(tour, ROADS, REGION_FEATURES)).length;
        const buildings = (await settle(tour, BUILDINGS, MIN_BUILDINGS)).length;
        const labels = await count(tour, LABELS);
        lines.push(`${city.name} z${zoom}: yol ${roads}, bina ${buildings}, yazı ${labels}`);
        if (roads < REGION_FEATURES || buildings < MIN_BUILDINGS) return { outcome: 'fail', note: lines.join('; ') };
      }
    }
    return { outcome: 'pass', note: lines.join('; ') };
  });
});

export const sdkFormatZoomLadder: DeviceTest = test('sdk.fmt-zoom-ladder', 'Paket biçimi: Kadıköy z12 - z18 her basamakta çizim (z15 - z17 zorunlu)', (ctx) =>
  withTour(ctx, async (tour) => {
    const lines: string[] = [];
    for (const zoom of [12, 13, 14, 15, 16, 17, 18]) {
      tour.say(`Kadıköy zoom ${zoom}`);
      await tour.go({ center: KADIKOY, zoom }, 'jump');
      const roads = (await settle(tour, ROADS, 1)).length;
      const buildings = (await settle(tour, BUILDINGS, 1)).length;
      lines.push(`z${zoom}: yol ${roads}, bina ${buildings}`);
      if (zoom >= 15 && zoom <= 17 && (roads < REGION_FEATURES || buildings < REGION_FEATURES)) return { outcome: 'fail', note: lines.join('; ') };
      if (roads === 0) return { outcome: 'fail', note: `z${zoom} hiç yol çizilmedi: ${lines.join('; ')}` };
    }
    return { outcome: 'pass', note: lines.join('; ') };
  }),
);

export const sdkFormatPlaces: DeviceTest = test('sdk.fmt-places', 'Paket biçimi: işletme katmanı Kadıköy z16 da çizer, yer rozetleri ekranda', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: 16 }, 'jump');
    const places = (await settle(tour, ['ov-icon@', 'ov-brand@', 'service@'], 5)).length;
    if (places < 5) return { outcome: 'fail', note: `yalnızca ${places} işletme simgesi ya da rozeti` };
    return { outcome: 'pass', note: `${places} işletme simgesi ya da rozeti` };
  }),
);

export const sdkFormatRoutes: DeviceTest = test('sdk.fmt-routes', 'Rota sürüm 2: Ankara, İzmir, Bursa ve Antalya içinde rota bulunur, gidiş ve dönüş yakın', async (ctx) => {
  await install(ctx, CITIES.map((city) => city.id), ['address', 'route']);
  const { geo } = await openGeo(ctx, MAIN, { wipe: false });
  try {
    const lines: string[] = [];
    for (const city of CITIES) {
      const spec = CITY_ROUTES[city.id];
      if (!spec) continue;
      const started = Date.now();
      const there = await geo.route.route(spec.from, spec.to);
      const ms = Date.now() - started;
      const back = await geo.route.route(spec.to, spec.from);
      if (!there.ok || !back.ok) return { outcome: 'fail', note: `${city.name}: ${!there.ok ? there.code : back.ok ? '' : back.code}; ${lines.join('; ')}` };
      const km = there.distanceM / 1000;
      const ratio = back.distanceM / there.distanceM;
      lines.push(`${city.name} ${km.toFixed(1)} km, ${(there.durationS / 60).toFixed(0)} dk, ${there.geometry.length} nokta, ilk rota ${ms} ms, dönüş oranı ${ratio.toFixed(2)}`);
      if (km < spec.minKm || km > spec.maxKm) return { outcome: 'fail', note: `${city.name} mesafe ${km.toFixed(1)} km, beklenen ${spec.minKm}-${spec.maxKm}; ${lines.join('; ')}` };
      if (ratio < 0.6 || ratio > 1.6) return { outcome: 'fail', note: `${city.name} dönüş oranı ${ratio.toFixed(2)}; ${lines.join('; ')}` };
      if (there.geometry.length < 10) return { outcome: 'fail', note: `${city.name} çizgi ${there.geometry.length} nokta; ${lines.join('; ')}` };
    }
    return { outcome: 'pass', note: lines.join('; ') };
  } finally {
    await geo.dispose();
  }
});

export const sdkFormatSearch: DeviceTest = test('sdk.fmt-search', 'Paket biçimi: Ankara, İzmir, Bursa ve Antalya merkezinde noktadan adres bulunur', async (ctx) => {
  await install(ctx, CITIES.map((city) => city.id), ['address']);
  const { geo } = await openGeo(ctx, MAIN, { wipe: false });
  try {
    const lines: string[] = [];
    for (const city of CITIES) {
      const found = await geo.search.reverse(city.at);
      lines.push(`${city.name}: ${found ? (found.components.street ?? found.components.district ?? '?') : 'yok'}`);
      if (!found) return { outcome: 'fail', note: lines.join('; ') };
    }
    return { outcome: 'pass', note: lines.join('; ') };
  } finally {
    await geo.dispose();
  }
});

export const sdkFormatZstd: DeviceTest = test('sdk.fmt-zstd', 'Sıkıştırma: Bursa, Ankara ve İzmir rehber paketleri açılır, boyut ve SQLite başlığı doğru', async (ctx) => {
  const manifest = await manifestOf(ctx);
  const lines: string[] = [];
  for (const id of ZSTD_CITIES) {
    const file = manifest.regions.find((region) => region.id === id)?.files.find((entry) => entry.kind === 'directory');
    if (!file?.encoded) return { outcome: 'fail', note: `${id}: manifestte sıkıştırılmış rehber yok` };
    const packed = new Uint8Array(await (await fetch(`${ctx.packServerUrl}/${file.encoded.path}`)).arrayBuffer());
    if (packed.length !== file.encoded.size) return { outcome: 'fail', note: `${id}: indirilen ${packed.length}, manifest ${file.encoded.size}` };
    const stream = createZstdDecode().zstd();
    const started = Date.now();
    let produced = 0;
    let head = '';
    for (let offset = 0; offset < packed.length; offset += 256 * 1024) {
      const end = Math.min(packed.length, offset + 256 * 1024);
      for (const piece of stream.push(packed.subarray(offset, end), end >= packed.length)) {
        if (produced === 0) head = String.fromCharCode(...piece.subarray(0, 15));
        produced += piece.length;
      }
    }
    const seconds = Math.max(0.001, (Date.now() - started) / 1000);
    lines.push(`${id}: ${(packed.length / 1e6).toFixed(1)} → ${(produced / 1e6).toFixed(1)} MB, ${(produced / 1e6 / seconds).toFixed(1)} MB/sn`);
    if (produced !== file.size) return { outcome: 'fail', note: `${lines.join('; ')}; açılan boyut ${produced}, beklenen ${file.size}` };
    if (head !== 'SQLite format 3') return { outcome: 'fail', note: `${lines.join('; ')}; başlık "${head}"` };
  }
  return { outcome: 'pass', note: lines.join('; ') };
});

export const FORMAT_TESTS: DeviceTest[] = [sdkMapFormat, sdkFormatAll, sdkFormatCities, sdkFormatZoomLadder, sdkFormatPlaces, sdkFormatRoutes, sdkFormatSearch, sdkFormatZstd];
