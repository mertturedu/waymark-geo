import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { deliveryStop, type TracePoint } from '../src/core/learned/stops';
import { pinNoise } from '../test/sim/noise';
import { rng } from '../test/sim/random';
import { walkFor, type Tap } from '../test/sim/walks';
import { setsDir } from './addr-sets';

export const STOP_CASES = 120;
const TAPS: Tap[] = ['door', 'after', 'car'];
const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export type StopExpected = { point: [number, number]; seconds: number; samples: number; endsBefore: number; accuracyM: number } | null;
export type StopCase = { id: string; tap: Tap; truth: LngLat; pin: LngLat | null; confirm: { lng: number; lat: number }; trace: TracePoint[]; expected: StopExpected };

export function stopCases(): StopCase[] {
  const rand = rng(1400);
  const out: StopCase[] = [];
  for (let i = 0; i < STOP_CASES; i++) {
    const truth: LngLat = [round(29 + rand() * 0.1), round(41 + rand() * 0.05)];
    const tap = TAPS[i % 3] as Tap;
    const walk = walkFor(rand, { truth, tap, traffic: i % 2 === 0 });
    const pin = rand() < 0.5 ? (pinNoise(rand, truth).point.map(round) as LngLat) : null;
    const trace = walk.trace.map((p) => ({ lng: round(p.lng), lat: round(p.lat), accuracyM: round(p.accuracyM), speed: p.speed === null || p.speed === undefined ? null : round(p.speed), t: p.t }));
    const confirm = { lng: round(walk.confirm.point[0]), lat: round(walk.confirm.point[1]) };
    const stop = deliveryStop(trace, pin ? [pin] : [], confirm);
    out.push({ id: `walk-${i}`, tap, truth, pin, confirm, trace, expected: stop ? { point: [round(stop.point[0]), round(stop.point[1])], seconds: round(stop.seconds), samples: stop.samples, endsBefore: stop.endsBefore, accuracyM: round(stop.accuracyM) } : null });
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(setsDir(), 'device');
  mkdirSync(dir, { recursive: true });
  const cases = stopCases();
  writeFileSync(join(dir, 'stops.json'), JSON.stringify(cases));
  const found = cases.filter((c) => c.expected);
  const errors = found.map((c) => distanceM(c.expected?.point as LngLat, c.truth)).sort((a, b) => a - b);
  console.log(JSON.stringify({ file: join(dir, 'stops.json'), cases: cases.length, found: found.length, medianErrorM: Math.round((errors[Math.floor(errors.length / 2)] ?? 0) * 10) / 10 }));
}
