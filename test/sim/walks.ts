import type { LngLat } from '../../src/core/geo/cells';
import type { TracePoint } from '../../src/core/learned/stops';
import { moveBy } from './noise';
import { normal, type Rand } from './random';

export type Tap = 'door' | 'after' | 'car';
export type WalkOptions = { truth: LngLat; tap?: Tap; traffic?: boolean };
export type Walk = { trace: TracePoint[]; truth: LngLat; confirm: { point: LngLat; accuracyM: number }; tap: Tap };

type Segment = { from: [number, number]; to: [number, number]; seconds: number };

export const SAMPLE_EVERY_S = 3;
export const TRACE_SECONDS = 90;
export const STREET_OFFSET_M = 12;
const SPEED_NOISE = 0.25;
const NO_SPEED_SHARE = 0.2;

const between = (rand: Rand, low: number, high: number): number => low + (high - low) * rand();

function segmentsFor(rand: Rand, tap: Tap, traffic: boolean): { segments: Segment[]; tapAt: number } {
  const v = between(rand, 1.2, 1.6);
  const approach = between(rand, 70, 130);
  const street: [number, number] = [0, -STREET_OFFSET_M];
  const out: Segment[] = [];
  let cursor: [number, number] = [-approach, -STREET_OFFSET_M];
  if (traffic) {
    const at = between(rand, 0.25, 0.7) * approach;
    const stopAt: [number, number] = [-approach + at, -STREET_OFFSET_M];
    out.push({ from: cursor, to: stopAt, seconds: at / v }, { from: stopAt, to: stopAt, seconds: between(rand, 3, 8) });
    cursor = stopAt;
  }
  out.push({ from: cursor, to: street, seconds: Math.hypot(cursor[0] - street[0], cursor[1] - street[1]) / v });
  out.push({ from: street, to: [0, 0], seconds: STREET_OFFSET_M / 1.1 });
  const stay = between(rand, 5, 25);
  out.push({ from: [0, 0], to: [0, 0], seconds: stay });
  const total = out.reduce((s, x) => s + x.seconds, 0);
  const startOfStay = total - stay;
  if (tap === 'door') return { segments: out, tapAt: startOfStay + stay * between(rand, 0.6, 1) };
  out.push({ from: [0, 0], to: street, seconds: STREET_OFFSET_M / 1.1 });
  const away = tap === 'after' ? between(rand, 5, 25) : between(rand, 35, 60);
  const end: [number, number] = [away, -STREET_OFFSET_M];
  out.push({ from: street, to: end, seconds: away / v });
  if (tap === 'car') out.push({ from: end, to: end, seconds: between(rand, 6, 12) });
  const walked = out.reduce((s, x) => s + x.seconds, 0);
  return { segments: out, tapAt: tap === 'car' ? walked - between(rand, 1, 4) : walked };
}

function positionAt(segments: Segment[], at: number): [number, number] {
  let t = at;
  for (const s of segments) {
    if (t <= s.seconds) {
      const k = s.seconds > 0 ? t / s.seconds : 1;
      const still = s.from[0] === s.to[0] && s.from[1] === s.to[1];
      return [s.from[0] + (s.to[0] - s.from[0]) * k + (still ? Math.sin(at * 3.1) * 0.6 : 0), s.from[1] + (s.to[1] - s.from[1]) * k + (still ? Math.cos(at * 2.3) * 0.6 : 0)];
    }
    t -= s.seconds;
  }
  const last = segments[segments.length - 1] as Segment;
  return last.to;
}

function speedAt(segments: Segment[], at: number): number {
  let t = at;
  for (const s of segments) {
    if (t <= s.seconds) return s.seconds > 0 ? Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1]) / s.seconds : 0;
    t -= s.seconds;
  }
  return 0;
}

export function walkFor(rand: Rand, options: WalkOptions): Walk {
  const tap = options.tap ?? 'door';
  const { segments, tapAt } = segmentsFor(rand, tap, options.traffic ?? false);
  const trace: TracePoint[] = [];
  const noisy = (xy: [number, number], accuracy: number): LngLat => moveBy(options.truth, xy[0] + normal(rand, accuracy * 0.5), xy[1] + normal(rand, accuracy * 0.5));
  for (let seconds = 0; seconds <= TRACE_SECONDS; seconds += SAMPLE_EVERY_S) {
    const at = tapAt - seconds + between(rand, -0.4, 0.4);
    if (at < 0) break;
    const accuracy = between(rand, 4, 16);
    const point = noisy(positionAt(segments, at), accuracy);
    const speed = speedAt(segments, at);
    trace.push({ lng: point[0], lat: point[1], accuracyM: accuracy, speed: rand() < NO_SPEED_SHARE ? null : Math.max(0, speed + normal(rand, SPEED_NOISE)), t: Math.max(0, seconds) });
  }
  const accuracy = between(rand, 4, 16);
  return { trace, truth: options.truth, confirm: { point: noisy(positionAt(segments, tapAt), accuracy), accuracyM: accuracy }, tap };
}
