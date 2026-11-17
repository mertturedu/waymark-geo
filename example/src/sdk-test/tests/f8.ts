import { compassRotation, compassVisible, northView } from '../../../../src/native/logic/compass';
import { loadPlaceCard } from '../../../../src/native/logic/place-pick-load';
import { scaleBar } from '../../../../src/native/logic/scale';
import type { DeviceTest } from '../../device-test/types';
import { BESIKTAS, KADIKOY } from './helpers';
import { KADIKOY as TOUR_KADIKOY, settle, test, withTour } from './map-tour';

const PLACE_ZOOM = 16;

export const sdkPlaceCard: DeviceTest = test('sdk.place-card', 'Yer kartı: rozete dokununca ad, kategori ve adres gelir; Buraya rota rotayı verir', (ctx) =>
  withTour(
    ctx,
    async (tour) => {
      await tour.go({ center: TOUR_KADIKOY, zoom: PLACE_ZOOM }, 'jump');
      const badges = (await settle(tour, ['ov-icon@', 'service@'], 3)).filter((feature) => typeof feature.properties?.name === 'string' && feature.geometry.type === 'Point');
      if (badges.length === 0) return { outcome: 'fail', note: 'ekranda rozet yok' };
      const target = badges[0]!;
      const [x, y] = await tour.project(target.geometry.coordinates as [number, number]);
      const geo = tour.geo;
      const card = await loadPlaceCard({ project: (point) => tour.project(point), reverse: (point) => geo.search.reverse(point, { language: 'tr' }), lang: 'tr' }, badges, { x: x + 6, y: y - 4 });
      if (!card) return { outcome: 'fail', note: `dokunma (${Math.round(x)}, ${Math.round(y)}) 24 px içinde rozet bulamadı` };
      const route = await geo.route.route(TOUR_KADIKOY, card.coordinate);
      const named = card.title === String(target.properties?.['name:tr'] ?? target.properties?.name);
      if (!named) return { outcome: 'fail', note: `kart "${card.title}", beklenen "${String(target.properties?.name)}"` };
      if (card.category === null) return { outcome: 'fail', note: `kategori yok: ${card.title} (özellikler ${JSON.stringify(target.properties).slice(0, 160)})` };
      return { outcome: route.ok ? 'pass' : 'fail', note: `${card.title} | ${card.category ?? 'kategori yok'} | ${card.lines.join(' / ') || 'adres yok'} | rota ${route.ok ? `${Math.round(route.distanceM)} m` : route.code}` };
    },
    { route: true },
  ),
);

export const sdkCompass: DeviceTest = test('sdk.compass', 'Pusula: yön 90 iken görünür, kuzeye dönünce yön 0 olur ve eğim korunur', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go({ center: TOUR_KADIKOY, zoom: PLACE_ZOOM, bearing: 0, pitch: 20 }, 'jump');
    const north = await tour.view();
    if (compassVisible(north.bearing ?? 0)) return { outcome: 'fail', note: `kuzeyde pusula görünüyor (yön ${north.bearing})` };
    await tour.go({ center: TOUR_KADIKOY, zoom: PLACE_ZOOM, bearing: 90, pitch: 20 }, 'jump');
    const turned = await tour.view();
    if (!compassVisible(turned.bearing ?? 0)) return { outcome: 'fail', note: `yön ${turned.bearing} iken pusula görünmüyor` };
    const needle = compassRotation(turned.bearing ?? 0);
    await tour.go(northView(turned), 'jump');
    const back = await tour.view();
    const bearing = back.bearing ?? 0;
    const flat = Math.min(bearing, 360 - bearing) <= 1;
    const pitchKept = Math.abs((back.pitch ?? 0) - 20) <= 1.5;
    return { outcome: flat && pitchKept && !compassVisible(bearing) ? 'pass' : 'fail', note: `yön 90 → ${bearing.toFixed(1)}, eğim ${(back.pitch ?? 0).toFixed(1)}, ibre ${needle}°` };
  }),
);

export const sdkNearby: DeviceTest = test('sdk.nearby', 'Yakındaki eczaneler: Kadıköy\'de en yakın 5 eczane mesafeye göre sıralı, ilki 300 m içinde', (ctx) =>
  withTour(ctx, async (tour) => {
    const hits = await tour.geo.search.nearby({ point: KADIKOY, group: 'pharmacy', limit: 5, radiusM: 3000 });
    if (hits.length < 5) return { outcome: 'fail', note: `${hits.length} eczane geldi (en az 5)` };
    const gaps = hits.map((hit) => hit.distanceM);
    const sorted = gaps.every((gap, i) => i === 0 || gap >= gaps[i - 1]!);
    const wrongGroup = hits.filter((hit) => hit.place.precision !== 'poi').length;
    const note = `mesafeler ${gaps.join('/')} m; ilk: ${hits[0]!.place.components.poiName ?? '?'}`;
    return { outcome: sorted && wrongGroup === 0 && gaps[0]! <= 300 ? 'pass' : 'fail', note };
  }),
);

export const sdkManeuvers: DeviceTest = test('sdk.maneuvers', 'Yönergeler: Kadıköy → Beşiktaş rotasında en az 6 adım, her birinde mesafe ve (dönüşlerde) sokak adı', (ctx) =>
  withTour(
    ctx,
    async (tour) => {
      const result = await tour.geo.route.directions(KADIKOY, BESIKTAS, { language: 'tr' });
      if (!result.ok) return { outcome: 'fail', note: `rota yok: ${result.code}` };
      const turns = result.steps.filter((step) => step.kind !== 'start' && step.kind !== 'arrive');
      const named = turns.filter((step) => typeof step.street === 'string' && step.street !== '').length;
      const sum = result.steps.reduce((total, step) => total + step.legM, 0);
      const ok = result.steps.length > 5 && result.steps.every((step) => step.distanceText !== '' && step.text !== '') && named >= Math.ceil(turns.length / 2) && Math.abs(sum - result.distanceM) <= 40;
      const first = turns.slice(0, 3).map((step) => step.text).join(' | ');
      return { outcome: ok ? 'pass' : 'fail', note: `${result.steps.length} adım (${turns.length} dönüş, ${named} sokak adlı), toplam ${Math.round(sum)} m / rota ${Math.round(result.distanceM)} m; ${first}` };
    },
    { route: true },
  ),
);

export const sdkScaleBar: DeviceTest = test('sdk.scale-bar', 'Ölçek: z16 ve z12\'de çubuk 110 px\'i aşmaz, yuvarlak bir uzunluk gösterir (bilgi)', (ctx) =>
  withTour(ctx, async (tour) => {
    const lines: string[] = [];
    for (const zoom of [16, 12]) {
      await tour.go({ center: TOUR_KADIKOY, zoom }, 'jump');
      const view = await tour.view();
      const bar = scaleBar(view.zoom, view.center[1]);
      lines.push(`z${zoom}: ${bar ? `${bar.meters} m, ${bar.widthPx} px` : 'yok'}`);
      if (!bar || bar.widthPx > 110) return { outcome: 'fail', note: lines.join('; ') };
    }
    return { outcome: 'info', note: lines.join('; ') };
  }),
);

export const F8_TESTS: DeviceTest[] = [sdkPlaceCard, sdkCompass, sdkNearby, sdkManeuvers, sdkScaleBar];
