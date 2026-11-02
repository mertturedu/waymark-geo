import type { PlanControls } from '../../../../src/native';
import type { DeviceTest, TestResult } from '../../device-test/types';
import type { LngLat } from '../map-tour/driver';
import { PLAN_START, PLAN_STOPS } from '../plan-stops';
import { along, easeBearing, joinLegs, lineLength, ring, turnBetween, type Point } from '../sim/driving';
import { count, JS_GAP_MS, ROADS, test, withTour, type Tour } from './map-tour';

const TICK_MS = 110;
const STEP_M = 45;
const MAX_TURN = 25;
const PROBE_EVERY = 25;
const MIN_ROADS = 15;
const CENTER_PX = 60;

type Drive = { ticks: number; metres: number; maxGapMs: number; maxTurn: number; minRoads: number; offCenter: number; tickMs: number[] };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function drive(tour: Tour, line: ReadonlyArray<Point>, state: { bearing: number }, options: { zoom?: number; pitch?: number; onTick?: (index: number, point: Point) => Promise<void> | void } = {}): Promise<Drive> {
  const samples = along(line, STEP_M);
  const zoom = options.zoom ?? 16.6;
  const pitch = options.pitch ?? 50;
  const { width, height } = tour.size();
  const stats: Drive = { ticks: 0, metres: lineLength(line), maxGapMs: 0, maxTurn: 0, minRoads: Number.POSITIVE_INFINITY, offCenter: 0, tickMs: [] };
  const run = await tour.gaps(async () => {
    for (const [index, sample] of samples.entries()) {
      const started = Date.now();
      const next = easeBearing(state.bearing, sample.heading, MAX_TURN);
      stats.maxTurn = Math.max(stats.maxTurn, Math.abs(turnBetween(state.bearing, next)));
      state.bearing = next;
      tour.car(sample.point, sample.heading);
      await tour.step({ center: sample.point, zoom, bearing: next, pitch });
      if (options.onTick) await options.onTick(index, sample.point);
      if (index % PROBE_EVERY === PROBE_EVERY - 1) {
        stats.minRoads = Math.min(stats.minRoads, await count(tour, ROADS));
        const at = await tour.project(sample.point);
        stats.offCenter = Math.max(stats.offCenter, Math.hypot(at[0] - width / 2, at[1] - height / 2));
      }
      const spent = Date.now() - started;
      stats.tickMs.push(spent);
      await sleep(Math.max(0, TICK_MS - spent));
      stats.ticks++;
    }
  });
  stats.maxGapMs = run.maxGapMs;
  return stats;
}

const verdict = (stats: Drive[], extra: string[] = []): string[] => {
  const bad = [...extra];
  const gap = Math.max(...stats.map((s) => s.maxGapMs));
  const roads = Math.min(...stats.map((s) => s.minRoads));
  const off = Math.max(...stats.map((s) => s.offCenter));
  if (gap > JS_GAP_MS) bad.push(`JS boşluğu ${Math.round(gap)} ms`);
  if (Number.isFinite(roads) && roads < MIN_ROADS) bad.push(`sürüş sırasında en az yol ${roads} (≥ ${MIN_ROADS})`);
  if (off > CENTER_PX) bad.push(`araç ekran ortasından ${Math.round(off)} px uzaklaştı (≤ ${CENTER_PX})`);
  return bad;
};

const summary = (stats: Drive[]): string => {
  const ticks = stats.reduce((sum, s) => sum + s.ticks, 0);
  const metres = stats.reduce((sum, s) => sum + s.metres, 0);
  const all = stats.flatMap((s) => s.tickMs);
  const worst = Math.max(...all);
  const gap = Math.max(...stats.map((s) => s.maxGapMs));
  const roads = Math.min(...stats.map((s) => s.minRoads));
  return `${(metres / 1000).toFixed(1)} km, ${ticks} adım, adım süresi ortalama ${Math.round(all.reduce((a, b) => a + b, 0) / Math.max(1, all.length))} ms (en uzun ${worst} ms), JS boşluğu ${Math.round(gap)} ms, en az yol ${Number.isFinite(roads) ? roads : '-'}`;
};

async function planned(tour: Tour, points: LngLat[]): Promise<{ plan: PlanControls; ids: string[]; legs: Point[][]; order: string[] } | TestResult> {
  const plan = tour.plan();
  plan.clear();
  points.forEach((point, i) => plan.addStop(point, `Durak ${i + 1}`));
  plan.setStart(null, PLAN_START);
  plan.setEnd('free');
  await sleep(300);
  const result = await tour.plan().sort();
  if (!result.ok) return { outcome: 'fail', note: `${result.code}: ${result.detail ?? ''}` };
  if (result.unreachable.length > 0) return { outcome: 'fail', note: `${result.unreachable.length} durağa ulaşılamadı` };
  return { plan: tour.plan(), ids: result.order, legs: result.legs.map((leg) => leg.geometry as Point[]), order: result.order };
}

const failed = (value: unknown): value is TestResult => typeof value === 'object' && value !== null && 'outcome' in value;

export const sdkSimDrive = test('sdk.sim-drive', 'Sürüş simülasyonu: 5 duraklı rota sanal araçla sürülür, kamera yönü izler, duraklar sırayla işaretlenir', (ctx) =>
  withTour(
    ctx,
    async (tour) => {
      const set = await planned(tour, PLAN_STOPS.slice(0, 5));
      if (failed(set)) return set;
      const state = { bearing: 0 };
      const stats: Drive[] = [];
      const visited: string[] = [];
      const first = set.legs[0]![0]!;
      await tour.go({ center: first, zoom: 16.6, bearing: 0, pitch: 50 }, 'jump');
      for (const [index, leg] of set.legs.entries()) {
        tour.say(`Sürüş: ${index + 1}. bacak / ${set.legs.length}`);
        stats.push(await drive(tour, leg, state));
        const stop = set.order[index];
        if (stop) {
          tour.plan().visit(stop);
          visited.push(stop);
          await sleep(150);
          if (tour.plan().nextLeg !== visited.length) return { outcome: 'fail', note: `${index + 1}. duraktan sonra sıradaki bacak ${tour.plan().nextLeg} (beklenen ${visited.length})` };
        }
      }
      tour.car(null);
      const bad = verdict(stats, visited.length === set.order.length ? [] : [`${visited.length}/${set.order.length} durak işaretlendi`]);
      const note = `${set.order.length} durak işaretlendi; ${summary(stats)}`;
      return bad.length > 0 ? { outcome: 'fail', note: `${bad.join('; ')} · ${note}` } : { outcome: 'pass', note };
    },
    { route: true },
  ),
);

export const sdkSimRing = test('sdk.sim-ring', 'Sürüş simülasyonu: halkada otomatik 8 nokta arası sürülür, yön sürekli döner ve harita çizili kalır', (ctx) =>
  withTour(
    ctx,
    async (tour) => {
      const geo = tour.geo;
      const points = ring([29.08, 41.02], 2500, 8, 20);
      const legs: Point[][] = [];
      const lost: string[] = [];
      for (let i = 0; i < points.length; i++) {
        const route = await geo.route.route(points[i]!, points[(i + 1) % points.length]!);
        if (route.ok) legs.push(route.geometry as Point[]);
        else lost.push(`${i + 1}→${((i + 1) % points.length) + 1}: ${route.code}`);
      }
      if (legs.length < 6) return { outcome: 'fail', note: `${legs.length}/8 bacak yolu bulundu: ${lost.join(', ')}` };
      const line = joinLegs(legs);
      const state = { bearing: 0 };
      await tour.go({ center: line[0]!, zoom: 16.4, bearing: 0, pitch: 45 }, 'jump');
      let swept = 0;
      let last = state.bearing;
      const stats = await drive(tour, line, state, { zoom: 16.4, pitch: 45, onTick: () => {
        swept += Math.abs(turnBetween(last, state.bearing));
        last = state.bearing;
      } });
      tour.car(null);
      const bad = verdict([stats], swept < 300 ? [`toplam dönüş ${Math.round(swept)}° (≥ 300°)`] : []);
      const note = `${legs.length}/8 bacak${lost.length > 0 ? ` (bulunamayan: ${lost.join(', ')})` : ''}; toplam dönüş ${Math.round(swept)}°, en büyük tek adım dönüşü ${stats.maxTurn.toFixed(1)}°; ${summary([stats])}`;
      return bad.length > 0 ? { outcome: 'fail', note: `${bad.join('; ')} · ${note}` } : { outcome: 'pass', note };
    },
    { route: true },
  ),
);

export const sdkSimReplan = test('sdk.sim-replan', 'Sürüş simülasyonu: yolda kalan duraklar yeniden sıralanır, sürüş kesilmez ve tüm duraklar bir kez ziyaret edilir', (ctx) =>
  withTour(
    ctx,
    async (tour) => {
      const set = await planned(tour, PLAN_STOPS.slice(5, 11));
      if (failed(set)) return set;
      const state = { bearing: 0 };
      const stats: Drive[] = [];
      const seen: string[] = [];
      await tour.go({ center: set.legs[0]![0]!, zoom: 16.6, bearing: 0, pitch: 50 }, 'jump');
      for (let leg = 0; leg < 2; leg++) {
        tour.say(`Sürüş: ${leg + 1}. bacak`);
        stats.push(await drive(tour, set.legs[leg]!, state));
        tour.plan().visit(set.order[leg]!);
        seen.push(set.order[leg]!);
        await sleep(150);
      }
      const here = set.legs[1]![set.legs[1]!.length - 1]!;
      tour.say('Yolda yeniden sıralama');
      const started = Date.now();
      let finished = 0;
      const pending = tour.plan().sortRemaining(here, 1500).then((result) => {
        finished = Date.now() - started;
        return result;
      });
      const hold = along(set.legs[2]!, STEP_M).slice(0, 12).map((s) => s.point);
      const creeping = await drive(tour, hold, state);
      const result = await pending;
      stats.push(creeping);
      if (!result.ok) return { outcome: 'fail', note: `yeniden sıralama: ${result.code}` };
      const left = set.order.filter((id) => !seen.includes(id));
      const again = [...result.order].sort().join(',');
      if (again !== [...left].sort().join(',')) return { outcome: 'fail', note: `kalan duraklar tutmuyor: beklenen ${left.join(',')}, gelen ${result.order.join(',')}` };
      tour.car(null);
      for (const leg of result.legs) {
        stats.push(await drive(tour, leg.geometry as Point[], state));
        if (leg.to) {
          tour.plan().visit(leg.to);
          seen.push(leg.to);
        }
      }
      await sleep(150);
      const bad = verdict(stats);
      if (new Set(seen).size !== seen.length) bad.push('bir durak iki kez ziyaret edildi');
      if (seen.length !== set.order.length) bad.push(`${seen.length}/${set.order.length} durak ziyaret edildi`);
      if (tour.plan().nextLeg !== set.order.length) bad.push(`sıradaki bacak ${tour.plan().nextLeg}`);
      const note = `yeniden sıralama ${finished} ms, sırada ${result.order.length} durak; ${summary(stats)}`;
      return bad.length > 0 ? { outcome: 'fail', note: `${bad.join('; ')} · ${note}` } : { outcome: 'pass', note };
    },
    { route: true },
  ),
);

export const SIM_TESTS: DeviceTest[] = [sdkSimDrive, sdkSimRing, sdkSimReplan];
