import { act } from 'react-test-renderer';
import { renderHook } from '../helpers/render-hook';
import type { DirectionsResult } from '../../src/core/create-geo';
import type { LngLat } from '../../src/core/geo/cells';
import { describeStep } from '../../src/core/route/directions';
import { buildManeuvers } from '../../src/core/route/maneuvers';
import { REROUTE_GAP_MS, useNavigation, type NavFix, type NavigationOptions } from '../../src/native/react/useNavigation';

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

const GEOMETRY = line([0, 0], [0, 400], [300, 400]);
const DEST = at(300, 400);
const ok = (geometry: LngLat[]): DirectionsResult => ({ ok: true, region: '16', distanceM: 700, durationS: 70, approximate: false, geometry, from: geometry[0]!, to: geometry[geometry.length - 1]!, warnings: [], steps: buildManeuvers(geometry).map((s) => describeStep(s, 'tr')) });
const fix = (x: number, y: number, t: number): NavFix => ({ point: at(x, y), accuracyM: 5, at: t });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function setup(directions: NavigationOptions['directions']) {
  let clock = 0;
  const now = () => clock;
  const props = (f: NavFix | null): NavigationOptions => ({ directions, destination: DEST, fix: f, now });
  return { props, tick: (ms: number) => { clock += ms; } };
}

describe('useNavigation', () => {
  it('routes from the first fix and reports the next turn', async () => {
    const directions = jest.fn(async () => ok(GEOMETRY));
    const { props } = setup(directions);
    const hook = await renderHook((p: NavigationOptions) => useNavigation(p), props(null));
    expect(hook.result.current.state).toBe('routing');
    await hook.rerender(props(fix(0, 50, 1)));
    await flush();
    const nav = hook.result.current;
    expect(directions).toHaveBeenCalledTimes(1);
    expect(nav.state).toBe('active');
    if (nav.state === 'active') {
      expect(nav.progress?.next?.kind).toBe('right');
      expect(nav.cue?.text).toBe('350 m sonra Sağa dönün');
    }
  });

  it('speaks each cue once and the turn itself when it is close', async () => {
    const { props } = setup(async () => ok(GEOMETRY));
    const hook = await renderHook((p: NavigationOptions) => useNavigation(p), props(fix(0, 50, 1)));
    await flush();
    const first = hook.result.current.state === 'active' ? hook.result.current.cue : null;
    await hook.rerender(props(fix(0, 60, 2)));
    const same = hook.result.current.state === 'active' ? hook.result.current.cue : null;
    expect(same?.id).toBe(first?.id);
    await hook.rerender(props(fix(0, 385, 3)));
    const turn = hook.result.current.state === 'active' ? hook.result.current.cue : null;
    expect(turn?.text).toBe('Sağa dönün');
    expect(turn?.id).toBeGreaterThan(first?.id ?? 0);
  });

  it('reroutes after two fixes off the line, not more often than the gap', async () => {
    const directions = jest.fn(async () => ok(GEOMETRY));
    const { props, tick } = setup(directions);
    const hook = await renderHook((p: NavigationOptions) => useNavigation(p), props(fix(0, 50, 1)));
    await flush();
    tick(REROUTE_GAP_MS);
    await hook.rerender(props(fix(120, 100, 2)));
    expect(directions).toHaveBeenCalledTimes(1);
    await hook.rerender(props(fix(125, 100, 3)));
    expect(directions).toHaveBeenCalledTimes(2);
    await flush();
    await hook.rerender(props(fix(130, 100, 4)));
    await hook.rerender(props(fix(135, 100, 5)));
    expect(directions).toHaveBeenCalledTimes(2);
  });

  it('falls back to a straight line when there is no road data', async () => {
    const { props } = setup(async () => ({ ok: false, code: 'START_OUTSIDE_REGION' }));
    const hook = await renderHook((p: NavigationOptions) => useNavigation(p), props(fix(0, -1000, 1)));
    await flush();
    const nav = hook.result.current;
    expect(nav.state).toBe('birdseye');
    if (nav.state === 'birdseye') {
      expect(nav.reason).toBe('START_OUTSIDE_REGION');
      expect(nav.distanceM).toBeGreaterThan(1400);
      expect(nav.bearing).toBeGreaterThan(0);
      expect(nav.bearing).toBeLessThan(90);
    }
  });

  it('arrives at the end of the line', async () => {
    const { props } = setup(async () => ok(GEOMETRY));
    const hook = await renderHook((p: NavigationOptions) => useNavigation(p), props(fix(0, 50, 1)));
    await flush();
    await hook.rerender(props(fix(295, 400, 2)));
    expect(hook.result.current.state).toBe('arrived');
  });

  it('stays idle without a destination', async () => {
    const directions = jest.fn(async () => ok(GEOMETRY));
    const hook = await renderHook((p: NavigationOptions) => useNavigation(p), { directions, destination: null, fix: fix(0, 0, 1) });
    expect(hook.result.current.state).toBe('idle');
    expect(directions).not.toHaveBeenCalled();
  });
});
