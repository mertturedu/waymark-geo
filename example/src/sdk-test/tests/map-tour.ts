import chains from '../../../../src/native/map/chains.json';
import type { GeoNative, PlanControls } from '../../../../src/native';
import type { DeviceTest, TestContext, TestResult } from '../../device-test/types';
import { PLAN_START, PLAN_STOPS } from '../plan-stops';
import { openTour, type LngLat, type Look, type MapFeature, type Tour as BaseTour } from '../map-tour/driver';
import { openGeo, MAIN } from '../sandbox';
import { percentile } from './helpers';

export type Tour = BaseTour<GeoNative, PlanControls>;

const CHAIN_IDS = new Set((chains as { id: string }[]).map((c) => c.id));
const MAP_REGIONS = ['34', '20', '41'];
export const KADIKOY: LngLat = [29.0275, 40.9878];
const SPOTS: { name: string; at: LngLat }[] = [
  { name: 'Kadıköy', at: KADIKOY },
  { name: 'Beşiktaş', at: [29.0097, 41.0422] },
  { name: 'Üsküdar', at: [29.0153, 41.0226] },
  { name: 'Şişli', at: [28.9877, 41.0602] },
  { name: 'Bakırköy', at: [28.8723, 40.9806] },
];
export const DENIZLI: LngLat = [29.0875, 37.783];
export const IZMIT: LngLat = [29.9167, 40.7654];

const OPEN_MS = 10000;
const SETTLE_MS = 6000;
export const JS_GAP_MS = 400;
const PAN_P95_MS = 2500;
export const TAP_P95_MS = 150;

export const ROADS = ['roads_'];
export const BUILDINGS = ['buildings@'];
export const LABELS = ['roads_labels', 'pois@', 'places_', 'hood-labels'];
export const REGION_FEATURES = 20;
const APPEAR_MS = 12000;

export async function ensureMapPacks(ctx: TestContext, withRoute: boolean): Promise<GeoNative> {
  const { geo } = await openGeo(ctx, MAIN, { wipe: false });
  const lacking = (id: string): ('address' | 'tiles' | 'places' | 'route')[] => {
    const parts = geo.regions.status(id).installedParts;
    return ([...(['address', 'tiles', 'places'] as const), ...(withRoute && id === '34' ? (['route'] as const) : [])] as ('address' | 'tiles' | 'places' | 'route')[]).filter((part) => !parts.includes(part));
  };
  const missing = MAP_REGIONS.filter((id) => lacking(id).length > 0);
  const checked = await geo.regions.checkUpdates();
  const stale = MAP_REGIONS.filter((id) => !missing.includes(id) && geo.regions.status(id).state === 'update-available');
  const needed = [...missing, ...stale];
  if (needed.length === 0) return geo;
  if (!checked.ok) throw new Error(`paketler eksik ya da eski (${needed.join(', ')}) ve manifest alınamadı: ${checked.code}`);
  for (const id of needed) await geo.regions.download(id, { parts: [...geo.regions.status(id).installedParts, ...lacking(id)] });
  return geo;
}

export async function withTour(ctx: TestContext, run: (tour: Tour, openMs: number) => Promise<TestResult>, options: { look?: Look; route?: boolean } = {}): Promise<TestResult> {
  const geo = await ensureMapPacks(ctx, options.route === true);
  const tour = await openTour<GeoNative, PlanControls>(geo, options.look);
  try {
    const openMs = await tour.ready();
    return await run(tour, openMs);
  } catch (error) {
    return { outcome: 'fail', note: error instanceof Error ? error.message : String(error) };
  } finally {
    tour.close();
    await geo.dispose();
  }
}

export const count = async (tour: Tour, prefixes: string[]): Promise<number> => (await tour.query(prefixes)).length;
const prop = (feature: MapFeature, key: string): unknown => feature.properties?.[key];
const lineLength = (feature: MapFeature): number => {
  const coordinates = feature.geometry.coordinates as unknown[] | undefined;
  if (!coordinates) return 0;
  return feature.geometry.type === 'LineString' ? coordinates.length : feature.geometry.type === 'MultiLineString' ? coordinates.flat().length : 0;
};
export const ms = (values: number[]): string => values.map((v) => Math.round(v)).join('/');

export const test = (id: string, title: string, run: DeviceTest['run']): DeviceTest => ({ id, title, kind: 'auto', run });

export const sdkMapOpen = test('sdk.map-open', 'Harita turu: harita açılır, ilk kare çizilir, katmanlar kurulu', (ctx) =>
  withTour(ctx, async (tour, openMs) => {
    tour.say('Harita açıldı');
    const groups = { yol: tour.layers('roads_').length, bina: tour.layers('buildings@').length, rozet: tour.layers('ov-brand@').length, bilinen: tour.layers('ov-landmark@').length, genel: tour.layers('ov-icon@').length };
    const missing = Object.entries(groups).filter(([, n]) => n === 0).map(([name]) => name);
    if (missing.length > 0) return { outcome: 'fail', note: `stilde katman yok: ${missing.join(', ')}` };
    const size = tour.size();
    if (size.width < 200 || size.height < 300) return { outcome: 'fail', note: `harita boyutu ${size.width}x${size.height}` };
    return { outcome: openMs <= OPEN_MS ? 'pass' : 'fail', value: String(openMs), unit: 'ms (ilk tam çizim)', threshold: `≤ ${OPEN_MS} ms`, note: `${Object.entries(groups).map(([k, n]) => `${k} ${n}`).join(', ')}; ${size.width}x${size.height}` };
  }),
);

export const sdkMapZoomLadder = test('sdk.map-zoom-ladder', 'Harita turu: yakınlaştırma 10 → 18 → 10, her basamak tam çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: 10 }, 'jump');
    const steps = [12, 14, 15, 16, 17, 18, 16, 14, 12, 10];
    const times: number[] = [];
    for (const zoom of steps) {
      tour.say(`Yakınlaştırma ${zoom}`);
      times.push(await tour.go({ center: KADIKOY, zoom }, 'fly', 900));
      const view = await tour.view();
      if (Math.abs(view.zoom - zoom) > 0.2) return { outcome: 'fail', note: `${zoom} istendi, ${view.zoom.toFixed(2)} oldu` };
      if (zoom >= 14 && (await count(tour, ROADS)) === 0) return { outcome: 'fail', note: `zoom ${zoom}: çizilmiş yol yok` };
    }
    const worst = Math.max(...times);
    return { outcome: worst <= SETTLE_MS ? 'pass' : 'fail', value: String(Math.round(worst)), unit: 'ms (en yavaş basamak)', threshold: `≤ ${SETTLE_MS} ms`, note: `basamak süreleri ${ms(times)} ms` };
  }),
);

export const sdkMapLayers = test('sdk.map-layers', 'Harita turu: Kadıköy 16-17 yakınlıkta yol ve bina çizilir (yazı sayısı bilgi)', (ctx) =>
  withTour(ctx, async (tour) => {
    const found: string[] = [];
    for (const zoom of [16, 17]) {
      tour.say(`Kadıköy zoom ${zoom}`);
      await tour.go({ center: KADIKOY, zoom }, 'jump');
      const roads = await count(tour, ROADS);
      const buildings = await count(tour, BUILDINGS);
      const labels = await count(tour, LABELS);
      found.push(`z${zoom}: yol ${roads}, bina ${buildings}, yazı ${labels}`);
      if (roads === 0 || buildings === 0) return { outcome: 'fail', note: found.join('; ') };
    }
    return { outcome: 'pass', note: found.join('; ') };
  }),
);

export const sdkMapLabels = test('sdk.map-labels', 'Harita turu: Kadıköy 14 yakınlıkta mahalle ve yer yazıları çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    tour.say('Yazılar');
    await tour.go({ center: KADIKOY, zoom: 14 }, 'jump');
    const hoods = await tour.until(['hood-labels'], 1, 8000);
    const places = await tour.until(['places_', 'roads_labels', 'pois@'], 1, 8000);
    const names = (await tour.query(['hood-labels'])).map((f) => String(prop(f, 'name') ?? '')).filter((n) => n !== '').slice(0, 4);
    const note = `mahalle yazısı ${hoods.count} (${hoods.waitedMs} ms)${names.length ? ` [${names.join(', ')}]` : ''}, yer/sokak yazısı ${places.count} (${places.waitedMs} ms)`;
    return { outcome: hoods.count > 0 ? 'pass' : 'fail', note };
  }),
);

export const sdkMapBrands = test('sdk.map-brands', 'Harita turu: 5 ilçede zincir rozetleri ve bilinen yerler çizilir, konumları ekranda', (ctx) =>
  withTour(ctx, async (tour) => {
    const seen = new Set<string>();
    let brandTotal = 0;
    let landmarkTotal = 0;
    let outside = 0;
    const lines: string[] = [];
    const { width, height } = tour.size();
    for (const spot of SPOTS) {
      tour.say(`${spot.name}: rozetler`);
      await tour.go({ center: spot.at, zoom: 16 }, 'jump');
      const brands = await tour.query(['ov-brand@']);
      const landmarks = await tour.query(['ov-landmark@']);
      brandTotal += brands.length;
      landmarkTotal += landmarks.length;
      lines.push(`${spot.name} ${brands.length}/${landmarks.length}`);
      for (const feature of brands) {
        const id = String(prop(feature, 'b') ?? '');
        if (!CHAIN_IDS.has(id)) return { outcome: 'fail', note: `${spot.name}: bilinmeyen zincir kimliği "${id}"` };
        seen.add(id);
      }
      for (const feature of brands.slice(0, 6)) {
        if (feature.geometry.type !== 'Point') continue;
        const [x, y] = await tour.project(feature.geometry.coordinates as LngLat);
        if (x < -60 || y < -60 || x > width + 60 || y > height + 60) outside++;
      }
    }
    if (brandTotal < 10) return { outcome: 'fail', note: `5 ilçede yalnızca ${brandTotal} rozet (en az 10); ${lines.join(', ')}` };
    if (seen.size < 4) return { outcome: 'fail', note: `yalnızca ${seen.size} farklı zincir: ${[...seen].join(', ')}` };
    if (landmarkTotal === 0) return { outcome: 'fail', note: 'hiç bilinen yer simgesi çizilmedi' };
    if (outside > 0) return { outcome: 'fail', note: `${outside} rozet ekran dışında konumlanıyor` };
    return { outcome: 'pass', note: `${brandTotal} rozet, ${landmarkTotal} bilinen yer, ${seen.size} zincir (${[...seen].sort().join(', ')}); ilçe başına rozet/yer: ${lines.join(', ')}` };
  }),
);

export const sdkMapRegions = test('sdk.map-regions', 'Harita turu: İstanbul, Denizli ve Kocaeli arasında geçişte karolar yüklenir', (ctx) =>
  withTour(ctx, async (tour) => {
    const lines: string[] = [];
    const stops: { name: string; at: LngLat }[] = [{ name: 'İstanbul', at: KADIKOY }, { name: 'Denizli', at: DENIZLI }, { name: 'Kocaeli', at: IZMIT }, { name: 'İstanbul', at: KADIKOY }];
    for (const stop of stops) {
      tour.say(`${stop.name}: karolar`);
      await tour.go({ center: stop.at, zoom: 15 }, 'jump');
      const roads = await tour.until(ROADS, REGION_FEATURES, APPEAR_MS);
      const buildings = await tour.until(BUILDINGS, REGION_FEATURES, APPEAR_MS);
      lines.push(`${stop.name} yol ${roads.count} (${roads.waitedMs} ms) bina ${buildings.count} (${buildings.waitedMs} ms)`);
      if (roads.count < REGION_FEATURES || buildings.count < REGION_FEATURES) return { outcome: 'fail', note: `${lines.join('; ')}; beklenen en az ${REGION_FEATURES}` };
    }
    tour.say('Türkiye genel görünüm');
    await tour.go({ center: [35, 39], zoom: 5 }, 'jump');
    const overview = await tour.until(['earth@', 'boundaries', 'places_'], 1, APPEAR_MS);
    lines.push(`genel görünüm ${overview.count} öğe`);
    return { outcome: overview.count > 0 ? 'pass' : 'fail', note: lines.join('; ') };
  }),
);

export const sdkMapMotion = test('sdk.map-motion', 'Harita turu: uçuş, kaydırma ve yakınlaştırma sırasında arayüz donmaz', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: 14 }, 'jump');
    tour.say('Uçuşlar');
    const flights = await tour.gaps(async () => {
      const times: number[] = [];
      for (const stop of [{ center: SPOTS[1]!.at, zoom: 15 }, { center: SPOTS[4]!.at, zoom: 13 }, { center: KADIKOY, zoom: 16 }]) times.push(await tour.go(stop, 'fly', 2500));
      return times;
    });
    tour.say('Kaydırma');
    const { width, height } = tour.size();
    const pans: number[] = [];
    const panGap = await tour.gaps(async () => {
      for (let i = 0; i < 12; i++) {
        const view = await tour.view();
        const dx = i % 2 === 0 ? 220 : -120;
        const dy = i % 3 === 0 ? -180 : 140;
        const target = await tour.unproject([width / 2 + dx, height / 2 + dy]);
        pans.push(await tour.go({ center: target, zoom: view.zoom }, 'jump'));
      }
    });
    const worstGap = Math.max(flights.maxGapMs, panGap.maxGapMs);
    const p95 = percentile(pans, 0.95);
    const note = `uçuş en uzun JS boşluğu ${flights.maxGapMs} ms, kaydırma ${panGap.maxGapMs} ms; uçuş süreleri ${ms(flights.value)} ms; kaydırma (görüntü durulana kadar) ortanca ${Math.round(percentile(pans, 0.5))} ms, p95 ${Math.round(p95)} ms`;
    if (worstGap > JS_GAP_MS) return { outcome: 'fail', value: String(worstGap), unit: 'ms (en uzun JS boşluğu)', threshold: `≤ ${JS_GAP_MS} ms`, note };
    return { outcome: p95 <= PAN_P95_MS ? 'pass' : 'fail', value: String(Math.round(p95)), unit: 'ms (kaydırma, p95)', threshold: `≤ ${PAN_P95_MS} ms ve JS boşluğu ≤ ${JS_GAP_MS} ms`, note };
  }),
);

export const sdkMapLook = test('sdk.map-look', 'Harita turu: açık/koyu tema ve 6 dil arasında geçişte harita yeniden çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: 16 }, 'jump');
    const combos: Look[] = ['de', 'en', 'tr', 'ru', 'el', 'ar', 'tr'].map((lang) => ({ theme: 'light' as const, lang }));
    combos.push({ theme: 'dark', lang: 'ar' }, { theme: 'dark', lang: 'tr' }, { theme: 'dark', lang: 'en' }, { theme: 'light', lang: 'ar' }, { theme: 'light', lang: 'tr' });
    const times: number[] = [];
    const broken: string[] = [];
    for (const [index, next] of combos.entries()) {
      tour.say(`Tema ${next.theme}, dil ${next.lang}`);
      try {
        times.push(await tour.look(next));
        const roads = (await tour.until(ROADS, 1, 6000)).count;
        const view = await tour.view();
        if (roads === 0) {
          const groups = await Promise.all(['earth@', 'water', 'buildings@', 'landuse', 'places_', 'ov-'].map(async (prefix) => `${prefix} ${await count(tour, [prefix])}`));
          const bare = await tour.look({ ...next, bare: true }).then(async () => (await tour.until(ROADS, 1, 6000)).count, () => -1);
          await tour.look({ ...next, bare: false }).catch(() => undefined);
          broken.push(`#${index + 1} ${next.theme}/${next.lang}: yol yok; sayılar ${groups.join(', ')}; yazısız stilde yol ${bare}; olaylar ${tour.events().slice(-6).join(' > ')}`);
        }
        else if (Math.abs(view.zoom - 16) > 0.3) broken.push(`#${index + 1} ${next.theme}/${next.lang}: zoom ${view.zoom.toFixed(2)}`);
      } catch (error) {
        broken.push(`#${index + 1} ${next.theme}/${next.lang}: ${error instanceof Error ? error.message : String(error)}; olaylar ${tour.events().slice(-8).join(' > ')}`);
      }
    }
    const worst = times.length > 0 ? Math.max(...times) : 0;
    if (broken.length > 0) return { outcome: 'fail', note: `${broken.length}/${combos.length} geçiş bozuk: ${broken.join('; ')}` };
    return { outcome: worst <= OPEN_MS ? 'pass' : 'fail', value: String(Math.round(worst)), unit: 'ms (en yavaş yeniden çizim)', threshold: `≤ ${OPEN_MS} ms`, note: `${combos.length} geçiş: ${ms(times)} ms` };
  }),
);

export const sdkMapTap = test('sdk.map-tap', 'Harita turu: ekranın 9 noktasına dokunmanın karşılığı (ters arama) hızlı ve doğru', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: KADIKOY, zoom: 17 }, 'jump');
    const { width, height } = tour.size();
    const times: number[] = [];
    let found = 0;
    for (const fy of [0.3, 0.5, 0.7]) {
      for (const fx of [0.25, 0.5, 0.75]) {
        const point = await tour.unproject([width * fx, height * fy]);
        const started = Date.now();
        const place = await tour.geo.search.reverse(point, { language: 'tr' });
        await tour.geo.search.coverage(point);
        times.push(Date.now() - started);
        if (place) found++;
      }
    }
    const p95 = percentile(times, 0.95);
    const note = `9 dokunuş: ${found} adres bulundu, süreler ${ms(times)} ms`;
    if (found < 5) return { outcome: 'fail', note: `Kadıköy z17'de yalnızca ${found}/9 nokta adres verdi; ${note}` };
    return { outcome: p95 <= TAP_P95_MS ? 'pass' : 'fail', value: String(Math.round(p95)), unit: 'ms (p95)', threshold: `≤ ${TAP_P95_MS} ms`, note };
  }),
);

export const sdkMapPlan = test('sdk.map-plan', 'Harita turu: 30 durak sıralanır, rota çizgisi ve numaralı duraklar haritada görünür', (ctx) =>
  withTour(
    ctx,
    async (tour) => {
      const plan = tour.plan();
      plan.clear();
      PLAN_STOPS.forEach((point, i) => plan.addStop(point, `Durak ${i + 1}`));
      plan.setStart(null, PLAN_START);
      plan.setEnd('return');
      await new Promise((resolve) => setTimeout(resolve, 400));
      tour.say('30 durak sıralanıyor');
      const started = Date.now();
      const result = await tour.plan().sort();
      const sortMs = Date.now() - started;
      if (!result.ok) return { outcome: 'fail', note: `${result.code}: ${result.detail ?? ''}` };
      tour.say('Rota çiziliyor');
      await tour.go({ center: [29.035, 41.025], zoom: 10.4 }, 'jump');
      await new Promise((resolve) => setTimeout(resolve, 600));
      const dots = await tour.query(['geo-plan-dot']);
      const numbers = await tour.query(['geo-plan-number']);
      const lines = await tour.query(['geo-plan-line']);
      const vertices = lines.reduce((sum, f) => sum + lineLength(f), 0);
      const note = `${result.order.length} durak sıralandı (${sortMs} ms), haritada ${dots.length} nokta, ${numbers.length} numara, ${lines.length} çizgi parçası, ${vertices} köşe`;
      if (dots.length < result.order.length * 0.8) return { outcome: 'fail', note: `görünen durak az: ${note}` };
      if (lines.length === 0 || vertices < 100) return { outcome: 'fail', note: `rota çizgisi yok ya da kısa: ${note}` };
      return { outcome: 'pass', note };
    },
    { route: true },
  ),
);

export const MAP_TESTS: DeviceTest[] = [sdkMapOpen, sdkMapZoomLadder, sdkMapLayers, sdkMapLabels, sdkMapBrands, sdkMapRegions, sdkMapMotion, sdkMapLook, sdkMapTap, sdkMapPlan];
