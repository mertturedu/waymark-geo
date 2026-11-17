import { deliveryStop, type TracePoint } from '../../../../src/core/learned/stops';
import type { DeviceTest } from '../../device-test/types';

const DATA_VERSION = '20261028.20261030.3';
const M_PER_DEGREE = 111_195;
const REPEAT = 5;
const LIMIT_P95_MS = 5;

type Expected = { point: [number, number]; seconds: number; samples: number; endsBefore: number; accuracyM: number } | null;
type Case = { id: string; tap: string; truth: [number, number]; pin: [number, number] | null; confirm: { lng: number; lat: number }; trace: TracePoint[]; expected: Expected };

const round = (n: number): number => Math.round(n * 1e6) / 1e6;
const meters = (a: [number, number], b: [number, number]): number => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180) * M_PER_DEGREE, (a[1] - b[1]) * M_PER_DEGREE);
const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

export const sdkAddrStops: DeviceTest = {
  id: 'sdk.addr-stops',
  title: 'Durma noktası: 120 yürüyüş izinden teslim noktası Node ile birebir, onay GPS\'inden daha yakın ve teslim anında hesap süresi',
  kind: 'auto',
  async run(ctx) {
    const response = await fetch(`${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device/stops.json`);
    if (!response.ok) return { outcome: 'fail', note: `vaka dosyası yok (HTTP ${response.status}); scripts/build-stops-device-set.ts çalıştırılmalı` };
    const cases = (await response.json()) as Case[];
    const different: string[] = [];
    const gps: number[] = [];
    const stops: number[] = [];
    let found = 0;
    for (const c of cases) {
      const stop = deliveryStop(c.trace, c.pin ? [c.pin] : [], c.confirm);
      const got: Expected = stop ? { point: [round(stop.point[0]), round(stop.point[1])], seconds: round(stop.seconds), samples: stop.samples, endsBefore: stop.endsBefore, accuracyM: round(stop.accuracyM) } : null;
      if (JSON.stringify(got) !== JSON.stringify(c.expected)) different.push(`${c.id}: ${JSON.stringify(got)} ≠ ${JSON.stringify(c.expected)}`);
      if (got) {
        found++;
        gps.push(meters([c.confirm.lng, c.confirm.lat], c.truth));
        stops.push(meters(got.point, c.truth));
      }
    }
    const times: number[] = [];
    for (let r = 0; r < REPEAT; r++) {
      for (const c of cases) {
        const started = performance.now();
        deliveryStop(c.trace, c.pin ? [c.pin] : [], c.confirm);
        times.push(performance.now() - started);
      }
    }
    const p95 = quantile(times, 0.95);
    const medianGps = quantile(gps, 0.5);
    const medianStop = quantile(stops, 0.5);
    const note = `${cases.length} iz, ${found} durma noktası; hata ortanca onay GPS'i ${medianGps.toFixed(1)} m → durma ${medianStop.toFixed(1)} m; hesap p50 ${quantile(times, 0.5).toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`;
    if (different.length > 0) return { outcome: 'fail', note: `${different.length} vakada Node ile fark: ${different[0]}; ${note}` };
    if (medianStop >= medianGps) return { outcome: 'fail', note: `durma noktası onay GPS'inden yakın değil; ${note}` };
    if (p95 > LIMIT_P95_MS) return { outcome: 'fail', note: `hesap süresi p95 ${p95.toFixed(2)} ms > ${LIMIT_P95_MS} ms; ${note}` };
    return { outcome: 'pass', value: p95.toFixed(2), unit: 'ms p95', note };
  },
};
