import chains from '../../../../src/native/map/chains.json';
import type { DeviceTest } from '../../device-test/types';
import type { LngLat, MapFeature } from '../map-tour/driver';
import { KADIKOY, test, withTour, type Tour } from './map-tour';

const CARGO = new Set((chains as { id: string; group: string }[]).filter((chain) => chain.group === 'cargo').map((chain) => chain.id));
const SPOTS: { name: string; at: LngLat }[] = [
  { name: 'Kadıköy', at: [29.0278, 40.9925] },
  { name: 'Kozyatağı', at: [29.1114, 40.9806] },
  { name: 'Eminönü', at: [28.9752, 41.0158] },
  { name: 'Fatih', at: [28.9681, 41.0162] },
  { name: 'Bostancı', at: [29.0623, 40.984] },
  { name: 'Kartal', at: [29.143, 40.9958] },
];
const pause = (time: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, time));
const BADGES = ['ov-brand@'];
const PLACES = ['ov-icon@'];
const prop = (feature: MapFeature, key: string): string => String(feature.properties?.[key] ?? '');

async function settle(tour: Tour, prefixes: string[], min: number): Promise<MapFeature[]> {
  await tour.until(prefixes, min, 15000);
  let last = -1;
  let features = await tour.query(prefixes);
  for (let i = 0; i < 12 && features.length !== last; i++) {
    last = features.length;
    await pause(700);
    features = await tour.query(prefixes);
  }
  return features;
}

export const sdkMapCargo = test('sdk.map-cargo', 'Kargo şubeleri: Yurtiçi, Aras gibi şube rozetleri 6 yoğun noktada çizilir ve konumları ekranda', (ctx) =>
  withTour(ctx, async (tour) => {
    const found = new Map<string, number>();
    const lines: string[] = [];
    let total = 0;
    for (const spot of SPOTS) {
      tour.say(`${spot.name}: kargo şubeleri`);
      await tour.go({ center: spot.at, zoom: 16 }, 'jump');
      const features = await settle(tour, BADGES, 1);
      const cargo = features.filter((feature) => CARGO.has(prop(feature, 'b')));
      total += cargo.length;
      for (const feature of cargo) found.set(prop(feature, 'b'), (found.get(prop(feature, 'b')) ?? 0) + 1);
      lines.push(`${spot.name} ${cargo.length}`);
    }
    const names = [...found.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n}`);
    const note = `${total} kargo rozeti, ${found.size} marka (${names.join(', ')}); ${lines.join(', ')}`;
    if (total < 5 || found.size < 3) return { outcome: 'fail', note: `kargo rozeti az: ${note}` };
    return { outcome: 'pass', note };
  }),
);

export const sdkMapIconToggle = test('sdk.map-icon-toggle', 'Simge filtresi: sınıf, grup ve tek marka kapatılıp açılır, diğer simgeler yerinde kalır', (ctx) =>
  withTour(ctx, async (tour) => {
    const bad: string[] = [];
    const lines: string[] = [];
    await tour.go({ center: KADIKOY, zoom: 16 }, 'jump');
    await tour.until(BADGES, 3, 15000);
    const base = await settle(tour, [...BADGES, ...PLACES], 5);
    const badges = base.filter((feature) => prop(feature, 'b') !== '');
    const places = base.length - badges.length;
    if (badges.length === 0) return { outcome: 'fail', note: 'Kadıköy z16 rozet yok, filtre denenemez' };
    const counts = new Map<string, number>();
    for (const feature of badges) counts.set(prop(feature, 'b'), (counts.get(prop(feature, 'b')) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    lines.push(`taban: ${badges.length} rozet, ${places} simge, en çok ${top}`);

    await tour.look({ hide: ['brands'] });
    const noBrands = await settle(tour, [...BADGES, ...PLACES], 1);
    if (noBrands.some((feature) => prop(feature, 'b') !== '')) bad.push('rozetler kapatılınca hâlâ rozet var');
    if (noBrands.length < places * 0.5) bad.push(`rozetler kapatılınca diğer simgeler de azaldı (${noBrands.length}/${places})`);
    lines.push(`rozetler kapalı: ${noBrands.length} simge`);

    await tour.look({ hide: [`chain:${top}`] });
    const noChain = await settle(tour, [...BADGES, ...PLACES], 1);
    if (noChain.some((feature) => prop(feature, 'b') === top)) bad.push(`${top} kapatılınca hâlâ var`);
    const others = noChain.filter((feature) => prop(feature, 'b') !== '').length;
    if (others < (badges.length - (counts.get(top) ?? 0)) * 0.6) bad.push(`${top} kapatılınca diğer rozetler azaldı (${others})`);
    lines.push(`${top} kapalı: ${others} diğer rozet`);

    const groups = new Set(badges.map((feature) => prop(feature, 'g')));
    const group = [...groups][0];
    if (group) {
      await tour.look({ hide: [`group:${group}`] });
      const noGroup = await settle(tour, [...BADGES, ...PLACES], 1);
      if (noGroup.some((feature) => prop(feature, 'g') === group)) bad.push(`${group} grubu kapatılınca hâlâ var`);
      lines.push(`${group} grubu kapalı: ${noGroup.length} simge`);
    }

    await tour.look({ hide: [] });
    const back = await settle(tour, [...BADGES, ...PLACES], base.length * 0.9);
    if (back.length < base.length * 0.9) bad.push(`açılınca simge sayısı ${back.length}/${base.length}`);
    lines.push(`açık: ${back.length} simge`);
    return bad.length > 0 ? { outcome: 'fail', note: `${bad.join('; ')} · ${lines.join('; ')}` } : { outcome: 'pass', note: lines.join('; ') };
  }),
);

export const ICON_TESTS: DeviceTest[] = [sdkMapCargo, sdkMapIconToggle];
