import type { LngLat } from '../../src/core/geo/cells';
import { lineLengthM } from '../../src/core/geo/distance';
import { buildManeuvers, exitNumber, kindOfAngle, normalAngle, type ManeuverKind } from '../../src/core/route/maneuvers';

const COS = Math.cos((41 * Math.PI) / 180);
const at = (x: number, y: number): LngLat => [29 + x / (111195 * COS), 41 + y / 111195];

type Pen = { x: number; y: number; points: LngLat[] };
const pen = (): Pen => ({ x: 0, y: 0, points: [at(0, 0)] });
function go(p: Pen, headingDeg: number, meters: number, every = 3): Pen {
  const dx = Math.sin((headingDeg * Math.PI) / 180);
  const dy = Math.cos((headingDeg * Math.PI) / 180);
  for (let walked = every; walked <= meters + 1e-9; walked += every) p.points.push(at(p.x + dx * walked, p.y + dy * walked));
  if (meters % every !== 0) p.points.push(at(p.x + dx * meters, p.y + dy * meters));
  p.x += dx * meters;
  p.y += dy * meters;
  return p;
}
function circle(p: Pen, centre: [number, number], radius: number, fromDeg: number, toDeg: number): Pen {
  const steps = Math.ceil((Math.abs(toDeg - fromDeg) * Math.PI) / 180 * radius / 2);
  for (let i = 1; i <= steps; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    p.x = centre[0] + radius * Math.cos(a);
    p.y = centre[1] + radius * Math.sin(a);
    p.points.push(at(p.x, p.y));
  }
  return p;
}
const kinds = (steps: { kind: ManeuverKind }[]): ManeuverKind[] => steps.map((s) => s.kind);

describe('angle table', () => {
  it.each([
    [0, 'straight'], [19.9, 'straight'], [-19.9, 'straight'], [20, 'slight-right'], [-20, 'slight-left'], [44.9, 'slight-right'], [45, 'right'], [-45, 'left'], [90, 'right'], [134.9, 'right'], [135, 'sharp-right'], [-135, 'sharp-left'], [164.9, 'sharp-right'], [165, 'uturn'], [-165, 'uturn'], [180, 'uturn'],
  ] as [number, ManeuverKind][])('%d degrees is %s', (angle, kind) => {
    expect(kindOfAngle(angle)).toBe(kind);
  });

  it('keeps angles in the half open range', () => {
    expect(normalAngle(190)).toBe(-170);
    expect(normalAngle(-190)).toBe(170);
    expect(normalAngle(180)).toBe(180);
    expect(normalAngle(-180)).toBe(180);
    expect(normalAngle(720)).toBe(0);
  });

  it('counts the roundabout exit from the entry and exit headings', () => {
    expect(exitNumber(0, 90)).toBe(1);
    expect(exitNumber(0, 0)).toBe(2);
    expect(exitNumber(0, 270)).toBe(3);
    expect(exitNumber(0, 180)).toBe(4);
    expect(exitNumber(350, 80)).toBe(1);
  });
});

describe('golden turn table: 200 angles on a built route', () => {
  const angles = Array.from({ length: 200 }, (_, i) => -179 + i * 1.8);
  const expected = (angle: number): ManeuverKind | null => {
    const size = Math.abs(angle);
    for (const edge of [20, 45, 135, 165]) if (Math.abs(size - edge) < 3) return null;
    return kindOfAngle(angle);
  };

  it.each(angles.map((a) => [Math.round(a * 10) / 10]))('a corner of %d degrees', (angle) => {
    const want = expected(angle);
    if (want === null) return;
    const p = go(go(pen(), 0, 150), angle, 150);
    const steps = buildManeuvers(p.points);
    expect(kinds(steps)).toEqual(want === 'straight' ? ['start', 'arrive'] : ['start', want, 'arrive']);
    if (want !== 'straight') {
      expect(steps[1]!.atM).toBeGreaterThan(130);
      expect(steps[1]!.atM).toBeLessThan(170);
    }
  });
});

describe('buildManeuvers', () => {
  it('gives a start and an arrival for a straight road and measures the legs', () => {
    const steps = buildManeuvers(go(pen(), 30, 500).points);
    expect(kinds(steps)).toEqual(['start', 'arrive']);
    expect(steps[1]!.legM).toBe(500);
    expect(steps[1]!.atM).toBe(500);
  });

  it('turns left and right at the right distance with the leg since the last step', () => {
    const p = go(go(go(pen(), 0, 200), 270, 300), 0, 100);
    const steps = buildManeuvers(p.points);
    expect(kinds(steps)).toEqual(['start', 'left', 'right', 'arrive']);
    expect(steps[1]!.legM).toBeGreaterThan(190);
    expect(steps[2]!.legM).toBeGreaterThan(280);
    expect(steps.reduce((sum, s) => sum + s.legM, 0)).toBe(steps[3]!.atM);
    expect(steps[3]!.atM).toBeCloseTo(lineLengthM(p.points), -1);
  });

  it('merges a corner made of two short bends into one turn', () => {
    const p = go(go(go(pen(), 0, 150), 45, 12), 90, 150);
    expect(kinds(buildManeuvers(p.points))).toEqual(['start', 'right', 'arrive']);
  });

  it('keeps two bends to opposite sides apart', () => {
    const p = go(go(go(pen(), 0, 150), 30, 20), 0, 150);
    expect(kinds(buildManeuvers(p.points))).toEqual(['start', 'slight-right', 'slight-left', 'arrive']);
  });

  it('turns back on itself as a U-turn', () => {
    const p = go(go(pen(), 0, 150), 180, 150);
    expect(kinds(buildManeuvers(p.points))).toEqual(['start', 'uturn', 'arrive']);
  });

  it('reports a roundabout and the exit it leaves by (second exit: straight on)', () => {
    const p = go(pen(), 0, 150);
    circle(p, [0, 165], 15, -90, 90);
    go(p, 0, 150);
    const steps = buildManeuvers(p.points);
    expect(kinds(steps)).toEqual(['start', 'roundabout', 'arrive']);
    expect(steps[1]!.exit).toBe(2);
  });

  it('reports the third exit of a roundabout', () => {
    const p = go(pen(), 0, 150);
    circle(p, [0, 165], 15, -90, 180);
    go(p, 270, 150);
    const steps = buildManeuvers(p.points);
    expect(kinds(steps)).toEqual(['start', 'roundabout', 'arrive']);
    expect(steps[1]!.exit).toBe(3);
  });

  it('does not take a tight corner for a roundabout', () => {
    const p = go(go(pen(), 0, 150), 270, 150);
    expect(kinds(buildManeuvers(p.points))).not.toContain('roundabout');
  });

  it('copes with nothing, one point, a repeated point and a very short route', () => {
    expect(buildManeuvers([])).toEqual([]);
    expect(kinds(buildManeuvers([at(0, 0)]))).toEqual(['start', 'arrive']);
    expect(kinds(buildManeuvers([at(0, 0), at(0, 0)]))).toEqual(['start', 'arrive']);
    expect(kinds(buildManeuvers(go(pen(), 0, 20).points))).toEqual(['start', 'arrive']);
  });

  it('is the same every time', () => {
    const p = go(go(pen(), 0, 200), 90, 200);
    expect(buildManeuvers(p.points)).toEqual(buildManeuvers(p.points));
  });
});
