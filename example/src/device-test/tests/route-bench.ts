import { File } from 'expo-file-system';
import { readRoutePack } from '../../../../src/core/route/format';
import { createPlanner } from '../../../../src/core/route/planner';
import { parseManifest } from '../../../../src/core/region/manifest';
import { p95, seededSnaps } from '../route-bench-helpers';
import { nextTurn } from '../ui-yield';
import type { DeviceTest } from '../types';
import { installFile, packFile } from './pack-download';

const PLATE = '34';
const SIDE = 50;
const ROUTES = 200;
const MATRIX_LIMIT_MS = 2000;
const FROM: [number, number] = [29.0275, 40.9878];
const TO: [number, number] = [29.0097, 41.0422];

type Heap = { js_allocatedBytes?: number };
const heapMB = (): number | null => {
  const stats = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => Heap } }).HermesInternal?.getInstrumentedStats?.();
  return stats?.js_allocatedBytes !== undefined ? Math.round(stats.js_allocatedBytes / 1048576) : null;
};

export const routeBench: DeviceTest = {
  id: 'route.bench',
  title: 'Rota: İstanbul paketiyle 50 x 50 matris ve 200 rota',
  kind: 'auto',
  async run(ctx) {
    const response = await fetch(`${ctx.packServerUrl}/manifest-v1.json`);
    if (!response.ok) return { outcome: 'fail', note: `manifest-v1.json HTTP ${response.status}; sunucu dist/packs klasörünü sunmalı` };
    const routeFile = parseManifest(await response.text()).regions.find((r) => r.id === PLATE)?.files.find((f) => f.kind === 'route');
    if (!routeFile) return { outcome: 'fail', note: 'manifestte İstanbul rota paketi yok' };
    await installFile(ctx, routeFile);

    const heapBefore = heapMB();
    const loadStart = Date.now();
    const pack = readRoutePack(await new File(packFile(ctx, routeFile.path).uri).bytes());
    const planner = createPlanner(pack);
    const loadMs = Date.now() - loadStart;
    await nextTurn();

    const from = planner.snap(FROM[0], FROM[1]);
    const to = planner.snap(TO[0], TO[1]);
    const leg = from.ok && to.ok ? planner.route(from.snap, to.snap) : null;
    if (!leg) return { outcome: 'fail', note: 'Kadıköy - Beşiktaş rotası bulunamadı' };

    const next = seededSnaps(pack, 20261029);
    const matrixMs: number[] = [];
    for (let run = 0; run < 3; run++) {
      const sources = Array.from({ length: SIDE }, next);
      const targets = Array.from({ length: SIDE }, next);
      const started = Date.now();
      planner.matrix(sources, targets);
      matrixMs.push(Date.now() - started);
      await nextTurn();
    }
    const routeMs: number[] = [];
    for (let i = 0; i < ROUTES; i++) {
      const a = next();
      const b = next();
      const started = Date.now();
      planner.route(a, b);
      routeMs.push(Date.now() - started);
      if (i % 20 === 0) await nextTurn();
    }
    const heapAfter = heapMB();
    const worst = Math.max(...matrixMs);
    ctx.log(`route load ${loadMs} ms, matrix ${matrixMs.join('/')} ms`);

    const heapNote = heapBefore !== null && heapAfter !== null ? `, JS yığını ${heapBefore} MB -> ${heapAfter} MB` : '';
    const note = `paket okuma ${loadMs} ms, tek rota p95 ${p95(routeMs)} ms; Kadıköy - Beşiktaş ${(leg.distanceM / 1000).toFixed(1)} km, ${Math.round(leg.durationDs / 600)} dk${heapNote}`;
    return { outcome: worst <= MATRIX_LIMIT_MS ? 'pass' : 'fail', value: String(worst), unit: 'ms (matris, en kötü)', threshold: `≤ ${MATRIX_LIMIT_MS} ms`, note };
  },
};
