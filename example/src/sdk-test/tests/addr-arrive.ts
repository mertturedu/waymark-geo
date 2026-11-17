import type { Place } from '../../../../src/core';
import type { DeviceTest } from '../../device-test/types';
import { ensureRoute, percentile } from './helpers';

const DATA_VERSION = '20261028.20261030.3';
const PLATE = '34';
const MAX_OVERHEAD_MS = 50;

type Expected = { to: [number, number]; side: 'left' | 'right' | null; offM: number; onChain: boolean; target: 'entrance' | 'door'; chain: boolean; last?: string };
type Case = { id: string; street: string; hood: string | null; district: string | null; door: [number, number]; entrance: [number, number] | null; from: [number, number]; expected: Expected | null };

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

const placeOf = (c: Case): Place => ({
  id: `${PLATE}:a:${c.id}`,
  label: '',
  components: { street: c.street, ...(c.hood ? { neighbourhood: c.hood } : {}), ...(c.district ? { district: c.district } : {}) },
  coordinate: c.door,
  precision: 'address',
  approximate: false,
  source: 'osm',
  confidence: 1,
  region: PLATE,
  ...(c.entrance ? { entrance: c.entrance } : {}),
});

export const sdkAddrArrive: DeviceTest = {
  id: 'sdk.addr-arrive',
  title: 'Rota varışı: kapının sokak zincirine ve girişe varış, varış tarafı yazılı; 40 rota Node ile aynı',
  kind: 'auto',
  async run(ctx) {
    const response = await fetch(`${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device/arrive.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-arrive-device-set.ts çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const { geo } = await ensureRoute(ctx);
    try {
      const different: string[] = [];
      const plain: number[] = [];
      const arrived: number[] = [];
      let wording = 0;
      await geo.route.route((cases[0] as Case).from, (cases[0] as Case).door);
      for (const c of cases) {
        const want = c.expected as Expected;
        let started = performance.now();
        await geo.route.route(c.from, c.door);
        plain.push(performance.now() - started);
        started = performance.now();
        const got = await geo.route.route(c.from, c.door, { toPlace: placeOf(c) });
        arrived.push(performance.now() - started);
        const a = got.ok ? got.arrival : undefined;
        const seen: Expected | null = got.ok && a ? { to: [round(got.to[0]), round(got.to[1])], side: a.side, offM: a.offM, onChain: a.onChain, target: a.target, chain: want.chain } : null;
        const wanted: Expected = { to: want.to, side: want.side, offM: want.offM, onChain: want.onChain, target: want.target, chain: want.chain };
        if (JSON.stringify(seen) !== JSON.stringify(wanted)) different.push(`${c.id}: ${JSON.stringify(seen)} ≠ ${JSON.stringify(wanted)}`);
        if (want.last !== undefined) {
          const steps = await geo.route.directions(c.from, c.door, { toPlace: placeOf(c), language: 'tr' });
          const text = steps.ok ? steps.steps[steps.steps.length - 1]?.text : undefined;
          if (text !== want.last) different.push(`${c.id}: son adım "${text}" ≠ "${want.last}"`);
          else wording++;
        }
      }
      const overhead = percentile(arrived, 0.5) - percentile(plain, 0.5);
      const chained = cases.filter((c) => c.expected?.onChain).length;
      const sides = cases.filter((c) => c.expected?.side).length;
      const note = `${cases.length} rota (${chained} zincire varış, ${sides} tarafı söylenen, ${wording} yazılı son adım); süre p50 ${percentile(plain, 0.5).toFixed(0)} → ${percentile(arrived, 0.5).toFixed(0)} ms, p95 ${percentile(plain, 0.95).toFixed(0)} → ${percentile(arrived, 0.95).toFixed(0)} ms`;
      if (different.length > 0) return { outcome: 'fail', note: `${different.length} farklı: ${different[0]}; ${note}` };
      if (overhead > MAX_OVERHEAD_MS) return { outcome: 'fail', note: `zincirli rota ortanca ${overhead.toFixed(0)} ms yavaş (sınır ${MAX_OVERHEAD_MS}); ${note}` };
      return { outcome: 'pass', value: percentile(arrived, 0.95).toFixed(0), unit: 'ms p95', note };
    } finally {
      await geo.dispose();
    }
  },
};
