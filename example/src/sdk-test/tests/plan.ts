import type { PlanRequest } from '../../../../src/core/plan/types';
import type { DeviceTest } from '../../device-test/types';
import { PLAN_START, PLAN_STOPS } from '../plan-stops';
import { ensureRoute, metres } from './helpers';

const LIMIT_MS = 3000;

type Heap = { js_allocatedBytes?: number };
const heapMB = (): number | null => {
  const stats = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Heap } }).HermesInternal?.getInstrumentedStats?.();
  return stats?.js_allocatedBytes !== undefined ? Math.round(stats.js_allocatedBytes / 1048576) : null;
};

const stops = PLAN_STOPS.map((point, i) => ({ id: `s${i}`, point }));

export const sdkPlanThirty = {
  id: 'sdk.plan-thirty',
  title: 'Akıllı rota: 30 durak sıralanır, kurallara uyulur, 3 sn altında biter',
  kind: 'auto',
  async run(ctx) {
    const { geo } = await ensureRoute(ctx);
    try {
      const request: PlanRequest = { stops, start: { point: PLAN_START }, end: { kind: 'return' }, pins: [{ stopId: 's7', position: 3 }], precedence: [{ before: 's2', after: 's11' }, { before: 's20', after: 's5' }] };
      const loading = Date.now();
      await geo.route.route(PLAN_START, stops[0]!.point);
      const loadMs = Date.now() - loading;
      const heapBefore = heapMB();
      const started = Date.now();
      const result = await geo.plan.plan(request);
      const ms = Date.now() - started;
      const heapAfter = heapMB();
      if (!result.ok) return { outcome: 'fail', note: `${result.code}: ${result.detail ?? ''}` };
      if (result.order.length + result.unreachable.length !== stops.length) return { outcome: 'fail', note: `${result.order.length} sıralı, ${result.unreachable.length} ulaşılamaz, ${stops.length} durak` };
      if (result.order.indexOf('s7') !== 3) return { outcome: 'fail', note: 's7 üçüncü sıraya sabitlenmedi' };
      const ordered = (a: string, b: string): boolean => result.order.indexOf(a) < result.order.indexOf(b);
      if (!ordered('s2', 's11') || !ordered('s20', 's5')) return { outcome: 'fail', note: 'alış-teslim sırası bozuldu' };
      const last = result.legs[result.legs.length - 1];
      if (!last || last.to !== null) return { outcome: 'fail', note: 'tur başlangıca dönmüyor' };
      for (let i = 1; i < result.legs.length; i++) {
        const before = (result.legs[i - 1]?.geometry ?? []).slice(-1)[0];
        const after = (result.legs[i]?.geometry ?? [])[0];
        if (!before || !after || metres(before, after) > 1) return { outcome: 'fail', note: `${i}. bacak kopuk` };
      }
      const heap = heapBefore !== null && heapAfter !== null ? `, JS yığını ${heapBefore} -> ${heapAfter} MB` : '';
      const note = `${result.order.length} durak, ${(result.totalDistanceM / 1000).toFixed(1)} km, ${Math.round(result.totalDurationS / 60)} dk, ${result.strategy}, ${result.unreachable.length} ulaşılamaz; rota paketi ilk açılış ${loadMs} ms (ayrı ölçülür)${heap}`;
      return { outcome: ms <= LIMIT_MS ? 'pass' : 'fail', value: String(ms), unit: 'ms (sıralama ve bacaklar, paket açıkken)', threshold: `≤ ${LIMIT_MS} ms`, note };
    } finally {
      await geo.dispose();
    }
  },
} satisfies DeviceTest;

export const sdkPlanKeep = {
  id: 'sdk.plan-keep',
  title: 'Akıllı rota: kalanları sırala (gidilenler dışarıda) ve elle sıra korunur',
  kind: 'auto',
  async run(ctx) {
    const { geo } = await ensureRoute(ctx);
    try {
      const kept = await geo.plan.plan({ stops: stops.slice(0, 8), mode: 'keep', start: { point: PLAN_START } });
      if (!kept.ok) return { outcome: 'fail', note: `keep: ${kept.code}` };
      const same = kept.order.every((id, i) => id === stops[i]?.id);
      if (!same) return { outcome: 'fail', note: 'elle sıra değişti' };
      const rest = await geo.plan.plan({ stops: stops.slice(0, 12), visited: ['s0', 's1', 's2'], start: { point: stops[2]?.point ?? PLAN_START } });
      if (!rest.ok) return { outcome: 'fail', note: `kalanlar: ${rest.code}` };
      if (rest.order.some((id) => ['s0', 's1', 's2'].includes(id)) || rest.order.length + rest.unreachable.length !== 9) return { outcome: 'fail', note: 'gidilenler dışarıda kalmadı' };
      return { outcome: 'pass', note: `elle sıra ${kept.order.length} durak aynı, kalan ${rest.order.length} durak sıralandı` };
    } finally {
      await geo.dispose();
    }
  },
} satisfies DeviceTest;

export const PLAN_TESTS: DeviceTest[] = [sdkPlanThirty, sdkPlanKeep];
