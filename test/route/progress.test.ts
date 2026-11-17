import type { LngLat } from '../../src/core/geo/cells';
import { describeStep, type DirectionStep } from '../../src/core/route/directions';
import { buildManeuvers } from '../../src/core/route/maneuvers';
import { ARRIVE_M, cueText, dueCue, headingTo, OFF_ROUTE_M, trackRoute } from '../../src/core/route/progress';

const COS = Math.cos((41 * Math.PI) / 180);
const at = (x: number, y: number): LngLat => [29 + x / (111195 * COS), 41 + y / 111195];
const line = (...pairs: [number, number][]): LngLat[] => {
  const out: LngLat[] = [];
  for (let i = 0; i + 1 < pairs.length; i++) {
    const [ax, ay] = pairs[i]!;
    const [bx, by] = pairs[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
    for (let k = 0; k < n; k++) out.push(at(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
  }
  out.push(at(...(pairs[pairs.length - 1] as [number, number])));
  return out;
};

const GEOMETRY = line([0, 0], [0, 400], [300, 400], [300, 800]);
const STEPS: DirectionStep[] = buildManeuvers(GEOMETRY).map((step) => describeStep(step, 'tr'));
const route = { geometry: GEOMETRY, steps: STEPS, durationS: 100 };

describe('trackRoute', () => {
  it('finds the next turn and the distance to it', () => {
    const progress = trackRoute({ ...route, point: at(2, 100) });
    expect(progress.next?.kind).toBe('right');
    expect(progress.toNextM).toBeGreaterThan(290);
    expect(progress.toNextM).toBeLessThan(310);
    expect(progress.after?.kind).toBe('left');
    expect(progress.offRoute).toBe(false);
    expect(progress.arrived).toBe(false);
    expect(progress.offsetM).toBeCloseTo(2, 0);
  });

  it('estimates the remaining time from the remaining share of the line', () => {
    const progress = trackRoute({ ...route, point: at(300, 550) });
    expect(progress.remainingM).toBeGreaterThan(240);
    expect(progress.remainingM).toBeLessThan(260);
    expect(progress.remainingS).toBeCloseTo((100 * progress.remainingM) / 1100, 2);
  });

  it('moves on to the following turn once a turn is passed', () => {
    const progress = trackRoute({ ...route, point: at(20, 400) });
    expect(progress.next?.kind).toBe('left');
    expect(progress.after?.kind).toBe('arrive');
  });

  it('marks the courier off route beyond the slack and widens it with poor accuracy', () => {
    expect(trackRoute({ ...route, point: at(OFF_ROUTE_M + 10, 100) }).offRoute).toBe(true);
    expect(trackRoute({ ...route, point: at(OFF_ROUTE_M + 10, 100), accuracyM: 25 }).offRoute).toBe(false);
    expect(trackRoute({ ...route, point: at(OFF_ROUTE_M + 40, 100), accuracyM: 500 }).offRoute).toBe(true);
  });

  it('arrives near the end', () => {
    const progress = trackRoute({ ...route, point: at(300, 800 - ARRIVE_M + 5) });
    expect(progress.arrived).toBe(true);
    expect(progress.next).toBeNull();
    expect(progress.offRoute).toBe(false);
  });

  it('stays on the stretch it was on when the line passes near itself', () => {
    const loop = line([0, 0], [0, 200], [20, 200], [20, 0], [20, -200]);
    const steps = buildManeuvers(loop).map((step) => describeStep(step, 'tr'));
    const free = trackRoute({ geometry: loop, steps, durationS: 60, point: at(10, 100) });
    const held = trackRoute({ geometry: loop, steps, durationS: 60, point: at(10, 100), lastAlongM: 330 });
    expect(free.alongM).toBeLessThan(150);
    expect(held.alongM).toBeGreaterThan(300);
  });
});

describe('cues', () => {
  it('gives each cue level once, the closest one that applies', () => {
    expect(dueCue(800, -1)).toBeNull();
    expect(dueCue(480, -1)).toBe(0);
    expect(dueCue(480, 0)).toBeNull();
    expect(dueCue(140, 0)).toBe(1);
    expect(dueCue(100, -1)).toBe(1);
    expect(dueCue(20, 1)).toBe(2);
    expect(dueCue(20, 2)).toBeNull();
  });

  it('speaks the distance before the turn and only the action at the turn', () => {
    const right = STEPS.find((step) => step.kind === 'right')!;
    expect(cueText(right, 150, 1, 'tr')).toBe('150 m sonra Sağa dönün');
    expect(cueText(right, 20, 2, 'tr')).toBe('Sağa dönün');
    const arrive = STEPS[STEPS.length - 1]!;
    expect(cueText(arrive, 480, 0, 'tr')).toBe('500 m sonra varış noktasındasınız');
  });

  it('measures headings clockwise from north', () => {
    expect(headingTo(at(0, 0), at(0, 100))).toBeCloseTo(0, 3);
    expect(headingTo(at(0, 0), at(100, 0))).toBeCloseTo(90, 3);
    expect(headingTo(at(0, 0), at(0, -100))).toBeCloseTo(180, 3);
  });
});
