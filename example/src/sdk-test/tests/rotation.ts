import { PLAN_START, PLAN_STOPS } from '../plan-stops';
import type { LngLat, View } from '../map-tour/driver';
import type { DeviceTest, TestResult } from '../../device-test/types';
import { BUILDINGS, count, DENIZLI, IZMIT, JS_GAP_MS, KADIKOY, REGION_FEATURES, ROADS, TAP_P95_MS, test, withTour, ms, type Tour } from './map-tour';
import { percentile } from './helpers';

const turn = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const at = (bearing: number, pitch = 0, zoom = 16, center: LngLat = KADIKOY): View => ({ center, zoom, bearing, pitch });
const near = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

type Seen = { roads: number; buildings: number; bearing: number; pitch: number };

async function seen(tour: Tour): Promise<Seen> {
  const view = await tour.view();
  return { roads: await count(tour, ROADS), buildings: await count(tour, BUILDINGS), bearing: view.bearing ?? 0, pitch: view.pitch ?? 0 };
}

const wrong = (list: string[], total: number): TestResult | null => (list.length > 0 ? { outcome: 'fail', note: `${list.length}/${total} adım bozuk: ${list.join('; ')}` } : null);

export const sdkRotBearing = test('sdk.rot-bearing', 'Harita yönü: 0-360° döndürülür, her adımda yol ve bina çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go(at(0), 'jump');
    const base = await seen(tour);
    const steps = [0, 45, 90, 135, 180, 225, 270, 315, 360, 0];
    const bad: string[] = [];
    const lines: string[] = [];
    for (const bearing of steps) {
      tour.say(`Yön ${bearing}°`);
      await tour.go(at(bearing), 'jump');
      const now = await seen(tour);
      lines.push(`${bearing}°: yol ${now.roads}, bina ${now.buildings}`);
      if (turn(now.bearing, bearing) > 2) bad.push(`${bearing}° istendi, ${now.bearing.toFixed(1)}° geldi`);
      if (now.roads < base.roads * 0.5) bad.push(`${bearing}°: yol ${now.roads} (taban ${base.roads})`);
      if (now.buildings < base.buildings * 0.3) bad.push(`${bearing}°: bina ${now.buildings} (taban ${base.buildings})`);
    }
    return wrong(bad, steps.length) ?? { outcome: 'pass', note: lines.join(' | ') };
  }),
);

export const sdkRotNorth = test('sdk.rot-north', 'Harita yönü: kuzeye sıfırlama, negatif ve 360 üstü açılar doğru yorumlanır', (ctx) =>
  withTour(ctx, async (tour) => {
    const cases: { ask: number; want: number }[] = [
      { ask: -90, want: 270 },
      { ask: 450, want: 90 },
      { ask: 720, want: 0 },
      { ask: 359, want: 359 },
    ];
    const bad: string[] = [];
    for (const { ask, want } of cases) {
      await tour.go(at(ask, 45), 'jump');
      const now = await seen(tour);
      if (turn(now.bearing, want) > 2) bad.push(`${ask}° → ${now.bearing.toFixed(1)}° (beklenen ${want}°)`);
      if (now.roads === 0) bad.push(`${ask}°: yol yok`);
    }
    await tour.go(at(0, 0), 'jump');
    const north = await seen(tour);
    if (turn(north.bearing, 0) > 2 || Math.abs(north.pitch) > 2) bad.push(`kuzeye sıfırlama: ${north.bearing.toFixed(1)}° / eğim ${north.pitch.toFixed(1)}°`);
    return wrong(bad, cases.length + 1) ?? { outcome: 'pass', note: `${cases.map((c) => `${c.ask}→${c.want}`).join(', ')} ve kuzeye sıfırlama doğru` };
  }),
);

export const sdkRotPitch = test('sdk.rot-pitch', 'Harita eğimi: 0, 30, 60° eğimde ve dönmüşken yol ve bina çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go(at(0), 'jump');
    const base = await seen(tour);
    const bad: string[] = [];
    const lines: string[] = [];
    for (const bearing of [0, 90, 200]) {
      for (const pitch of [0, 30, 60]) {
        tour.say(`Yön ${bearing}°, eğim ${pitch}°`);
        await tour.go(at(bearing, pitch), 'jump');
        const now = await seen(tour);
        lines.push(`${bearing}°/${pitch}°: yol ${now.roads}, bina ${now.buildings}`);
        if (Math.abs(now.pitch - pitch) > 2) bad.push(`${bearing}°/${pitch}°: eğim ${now.pitch.toFixed(1)}°`);
        if (turn(now.bearing, bearing) > 2) bad.push(`${bearing}°/${pitch}°: yön ${now.bearing.toFixed(1)}°`);
        if (now.roads < base.roads * 0.3) bad.push(`${bearing}°/${pitch}°: yol ${now.roads}`);
        if (now.buildings < 20) bad.push(`${bearing}°/${pitch}°: bina ${now.buildings}`);
      }
    }
    return wrong(bad, 9) ?? { outcome: 'pass', note: lines.join(' | ') };
  }),
);

export const sdkRotProject = test('sdk.rot-project', 'Harita yönü: ekran-koordinat dönüşümü döndürmede doğru (yön, merkez, gidiş-dönüş)', (ctx) =>
  withTour(ctx, async (tour) => {
    const { width, height } = tour.size();
    const bad: string[] = [];
    const north: LngLat = [KADIKOY[0], KADIKOY[1] + 0.001];
    const expected: Record<number, (dx: number, dy: number) => boolean> = {
      0: (dx, dy) => dy < -20 && Math.abs(dx) < 4,
      90: (dx, dy) => dx < -20 && Math.abs(dy) < 4,
      180: (dx, dy) => dy > 20 && Math.abs(dx) < 4,
      270: (dx, dy) => dx > 20 && Math.abs(dy) < 4,
    };
    let worstRound = 0;
    for (const bearing of [0, 90, 180, 270, 33]) {
      await tour.go(at(bearing, 0, 17), 'jump');
      const centre = await tour.project(KADIKOY);
      if (Math.abs(centre[0] - width / 2) > 6 || Math.abs(centre[1] - height / 2) > 6) bad.push(`${bearing}°: merkez ${centre[0].toFixed(0)},${centre[1].toFixed(0)} (beklenen ${(width / 2).toFixed(0)},${(height / 2).toFixed(0)})`);
      const up = await tour.project(north);
      const check = expected[bearing];
      if (check && !check(up[0] - centre[0], up[1] - centre[1])) bad.push(`${bearing}°: kuzey noktası yanlış yönde (${(up[0] - centre[0]).toFixed(0)},${(up[1] - centre[1]).toFixed(0)})`);
      for (const [fx, fy] of [[0.2, 0.2], [0.8, 0.3], [0.5, 0.8], [0.3, 0.6]]) {
        const pixel: [number, number] = [width * fx!, height * fy!];
        const back = await tour.project(await tour.unproject(pixel));
        const drift = near(back, pixel);
        worstRound = Math.max(worstRound, drift);
        if (drift > 2) bad.push(`${bearing}°: gidiş-dönüş ${drift.toFixed(1)} px`);
      }
    }
    return wrong(bad, 5) ?? { outcome: 'pass', note: `5 yönde merkez, kuzey yönü ve gidiş-dönüş doğru; en kötü gidiş-dönüş ${worstRound.toFixed(2)} px` };
  }),
);

export const sdkRotTap = test('sdk.rot-tap', 'Harita yönü: dönmüş haritada 9 noktaya dokunmanın karşılığı doğru ve hızlı', (ctx) =>
  withTour(ctx, async (tour) => {
    const { width, height } = tour.size();
    const times: number[] = [];
    const bad: string[] = [];
    for (const bearing of [90, 200]) {
      await tour.go(at(bearing, 0, 17), 'jump');
      let found = 0;
      for (const fy of [0.3, 0.5, 0.7]) {
        for (const fx of [0.25, 0.5, 0.75]) {
          const point = await tour.unproject([width * fx, height * fy]);
          const started = Date.now();
          const place = await tour.geo.search.reverse(point, { language: 'tr' });
          times.push(Date.now() - started);
          if (place) found++;
          if (fx === 0.5 && fy === 0.5 && near(point, KADIKOY) > 3e-5) bad.push(`${bearing}°: ekran ortası ${point[0].toFixed(5)},${point[1].toFixed(5)}`);
        }
      }
      if (found < 5) bad.push(`${bearing}°: yalnızca ${found}/9 adres`);
    }
    const p95 = percentile(times, 0.95);
    if (bad.length > 0) return { outcome: 'fail', note: bad.join('; ') };
    return { outcome: p95 <= TAP_P95_MS ? 'pass' : 'fail', value: String(Math.round(p95)), unit: 'ms (p95)', threshold: `≤ ${TAP_P95_MS} ms`, note: `2 yönde 18 dokunuş, süreler ${ms(times.slice(0, 9))} ms (ilk yön)` };
  }),
);

export const sdkRotLabels = test('sdk.rot-labels', 'Harita yönü: Kadıköy 14 yakınlıkta dönmüşken mahalle yazıları çizilir', (ctx) =>
  withTour(ctx, async (tour) => {
    const bad: string[] = [];
    const lines: string[] = [];
    for (const bearing of [0, 90, 180, 270]) {
      await tour.go(at(bearing, 0, 14), 'jump');
      const hoods = await tour.until(['hood-labels'], 1, 6000);
      lines.push(`${bearing}°: ${hoods.count}`);
      if (hoods.count === 0) bad.push(`${bearing}°: mahalle yazısı yok`);
    }
    return wrong(bad, 4) ?? { outcome: 'pass', note: `mahalle yazısı sayıları ${lines.join(', ')}` };
  }),
);

export const sdkRotFly = test('sdk.rot-fly', 'Harita yönü: uçuşla dönme ve eğilme sırasında arayüz donmaz', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go(at(0), 'jump');
    const target = at(180, 45, 16.5, [29.0345, 40.9921]);
    const run = await tour.gaps(() => tour.go(target, 'fly', 2500));
    const now = await seen(tour);
    const back = await tour.gaps(() => tour.go(at(0, 0), 'fly', 2500));
    const gap = Math.max(run.maxGapMs, back.maxGapMs);
    if (turn(now.bearing, 180) > 2 || Math.abs(now.pitch - 45) > 2) return { outcome: 'fail', note: `varış ${now.bearing.toFixed(1)}° / ${now.pitch.toFixed(1)}° (180° / 45° istendi)` };
    if (now.roads === 0) return { outcome: 'fail', note: 'uçuştan sonra yol çizilmedi' };
    return { outcome: gap <= JS_GAP_MS ? 'pass' : 'fail', value: String(Math.round(gap)), unit: 'ms (en uzun JS boşluğu)', threshold: `≤ ${JS_GAP_MS} ms`, note: `gidiş ${run.value} ms, dönüş ${back.value} ms; varışta yol ${now.roads}, bina ${now.buildings}` };
  }),
);

export const sdkRotSpin = test('sdk.rot-spin', 'Harita yönü: art arda tam tur (0 → 350 → 0) sonra harita bozulmaz', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go(at(0), 'jump');
    const base = await seen(tour);
    const started = Date.now();
    const run = await tour.gaps(async () => {
      for (const bearing of [60, 120, 180, 240, 300, 350, 300, 240, 180, 120, 60, 0]) await tour.go(at(bearing, bearing % 120 === 0 ? 30 : 0), 'fly', 700);
    });
    const now = await seen(tour);
    const bad: string[] = [];
    if (turn(now.bearing, 0) > 2) bad.push(`son yön ${now.bearing.toFixed(1)}°`);
    if (now.roads < base.roads * 0.5) bad.push(`yol ${now.roads} (taban ${base.roads})`);
    if (now.buildings < base.buildings * 0.3) bad.push(`bina ${now.buildings} (taban ${base.buildings})`);
    if (run.maxGapMs > JS_GAP_MS) bad.push(`JS boşluğu ${run.maxGapMs} ms`);
    return bad.length > 0 ? { outcome: 'fail', note: bad.join('; ') } : { outcome: 'pass', note: `12 uçuş ${Date.now() - started} ms, en uzun JS boşluğu ${Math.round(run.maxGapMs)} ms, sonda yol ${now.roads}, bina ${now.buildings}` };
  }),
);

export const sdkRotRegions = test('sdk.rot-regions', 'Harita yönü: dönmüşken İstanbul, Denizli, Kocaeli arasında geçişte karolar yüklenir', (ctx) =>
  withTour(ctx, async (tour) => {
    const bad: string[] = [];
    const lines: string[] = [];
    const stops: { name: string; at: LngLat; bearing: number }[] = [
      { name: 'Denizli', at: DENIZLI, bearing: 135 },
      { name: 'Kocaeli', at: IZMIT, bearing: 250 },
      { name: 'İstanbul', at: KADIKOY, bearing: 20 },
    ];
    for (const stop of stops) {
      tour.say(`${stop.name}, yön ${stop.bearing}°`);
      await tour.go({ center: stop.at, zoom: 15, bearing: stop.bearing, pitch: 20 }, 'jump');
      const roads = (await tour.until(ROADS, REGION_FEATURES, 12000)).count;
      lines.push(`${stop.name} yol ${roads}`);
      if (roads < REGION_FEATURES) bad.push(`${stop.name}: yol ${roads}`);
    }
    return wrong(bad, stops.length) ?? { outcome: 'pass', note: lines.join(', ') };
  }),
);

export const sdkRotLayout = test('sdk.rot-layout', 'Ekran dönüşü: yatay, yarım ve kare çerçevede harita yeniden düzenlenir, merkez ve yakınlık korunur', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go(at(0), 'jump');
    const full = tour.size();
    const base = await seen(tour);
    const bad: string[] = [];
    const lines: string[] = [];
    let worstGap = 0;
    for (const frame of ['landscape', 'half', 'square', 'full'] as const) {
      tour.say(`Çerçeve ${frame}`);
      const run = await tour.gaps(() => tour.frame(frame));
      worstGap = Math.max(worstGap, run.maxGapMs);
      const size = tour.size();
      const view = await tour.view();
      const now = await seen(tour);
      lines.push(`${frame} ${Math.round(size.width)}x${Math.round(size.height)} yol ${now.roads}`);
      if (frame === 'landscape' && !(size.width > size.height)) bad.push(`yatay: ${size.width}x${size.height}`);
      if (frame === 'half' && !(size.height > full.height * 0.4 && size.height < full.height * 0.6 && Math.abs(size.width - full.width) < 3)) bad.push(`yarım: ${size.width}x${size.height} (tam ${full.width}x${full.height})`);
      if (frame === 'square' && Math.abs(size.width - size.height) > 3) bad.push(`kare: ${size.width}x${size.height}`);
      if (frame === 'full' && (Math.abs(size.width - full.width) > 3 || Math.abs(size.height - full.height) > 3)) bad.push(`tam: ${size.width}x${size.height}`);
      if (Math.abs(view.zoom - 16) > 0.1 || near(view.center, KADIKOY) > 1e-4) bad.push(`${frame}: görünüm kaydı (zoom ${view.zoom.toFixed(2)})`);
      if (now.roads < base.roads * 0.3) bad.push(`${frame}: yol ${now.roads}`);
    }
    if (worstGap > JS_GAP_MS) bad.push(`JS boşluğu ${worstGap} ms`);
    return wrong(bad, 4) ?? { outcome: 'pass', note: lines.join(' | ') };
  }),
);

export const sdkRotLayoutTurn = test('sdk.rot-layout-turn', 'Ekran dönüşü: yatay çerçevede yön ve eğim birlikte çalışır, geri dönünce harita aynı', (ctx) =>
  withTour(ctx, async (tour) => {
    await tour.go(at(0), 'jump');
    const base = await seen(tour);
    await tour.frame('landscape');
    const bad: string[] = [];
    const { width, height } = tour.size();
    for (const [bearing, pitch] of [[90, 45], [200, 0], [310, 60]] as const) {
      await tour.go(at(bearing, pitch), 'jump');
      const now = await seen(tour);
      if (turn(now.bearing, bearing) > 2 || Math.abs(now.pitch - pitch) > 2) bad.push(`${bearing}°/${pitch}°: ${now.bearing.toFixed(1)}°/${now.pitch.toFixed(1)}°`);
      if (now.roads < base.roads * 0.3) bad.push(`${bearing}°/${pitch}°: yol ${now.roads}`);
      const centre = await tour.project(KADIKOY);
      if (Math.abs(centre[0] - width / 2) > 6 || Math.abs(centre[1] - height / 2) > 6) bad.push(`${bearing}°/${pitch}°: merkez kaydı`);
    }
    await tour.frame('full');
    await tour.go(at(0, 0), 'jump');
    const back = await seen(tour);
    if (back.roads < base.roads * 0.8 || back.buildings < base.buildings * 0.8) bad.push(`dönüşte yol ${back.roads}/${base.roads}, bina ${back.buildings}/${base.buildings}`);
    return wrong(bad, 4) ?? { outcome: 'pass', note: `yatayda 3 yön/eğim doğru; dönüşte yol ${back.roads} (taban ${base.roads}), bina ${back.buildings} (taban ${base.buildings})` };
  }),
);

export const sdkRotPlan = test('sdk.rot-plan', 'Harita yönü: 30 duraklı rota dönmüş ve eğik haritada da çizilir', (ctx) =>
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
      const result = await tour.plan().sort();
      if (!result.ok) return { outcome: 'fail', note: `${result.code}: ${result.detail ?? ''}` };
      const centre: LngLat = [29.035, 41.025];
      const bad: string[] = [];
      const lines: string[] = [];
      for (const [bearing, pitch] of [[0, 0], [45, 0], [135, 30], [270, 0]] as const) {
        tour.say(`Rota, yön ${bearing}°, eğim ${pitch}°`);
        await tour.go({ center: centre, zoom: 9.6, bearing, pitch }, 'jump');
        await new Promise((resolve) => setTimeout(resolve, 500));
        const dots = (await tour.query(['geo-plan-dot'])).length;
        const numbers = (await tour.query(['geo-plan-number'])).length;
        const lineParts = (await tour.query(['geo-plan-line'])).length;
        lines.push(`${bearing}°/${pitch}°: ${dots} nokta, ${numbers} numara, ${lineParts} çizgi`);
        if (dots < result.order.length * 0.6) bad.push(`${bearing}°/${pitch}°: nokta ${dots}`);
        if (lineParts === 0) bad.push(`${bearing}°/${pitch}°: çizgi yok`);
      }
      return wrong(bad, 4) ?? { outcome: 'pass', note: lines.join(' | ') };
    },
    { route: true },
  ),
);

export const ROTATION_TESTS: DeviceTest[] = [sdkRotBearing, sdkRotNorth, sdkRotPitch, sdkRotProject, sdkRotTap, sdkRotLabels, sdkRotFly, sdkRotSpin, sdkRotRegions, sdkRotLayout, sdkRotLayoutTurn, sdkRotPlan];
