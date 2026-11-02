import { solveExact } from '../../src/core/plan/exact';
import { solveHeuristic } from '../../src/core/plan/heuristic';
import { costOf, type Problem } from '../../src/core/plan/problem';
import { obeys } from '../../src/core/plan/rules';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: p.length + 1 }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

function problemOf(size: number, next: () => number, extra: Partial<Problem> = {}): Problem {
  const points = Array.from({ length: size + 1 }, () => [next() * 100, next() * 100] as const);
  const dist = (a: number, b: number): number => Math.round(Math.hypot((points[a] as readonly number[])[0] as number - ((points[b] as readonly number[])[0] as number), ((points[a] as readonly number[])[1] as number) - ((points[b] as readonly number[])[1] as number)) * 10) + (a > b ? 3 : 0);
  return {
    size,
    from: Array.from({ length: size }, (_, i) => dist(0, i + 1)),
    between: Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => dist(i + 1, j + 1))),
    back: null,
    rules: { size, pins: new Map(), before: [] },
    ...extra,
  };
}

describe('exact solver', () => {
  it('matches brute force with pins, precedence and a return leg', () => {
    const next = seeded(5);
    for (let round = 0; round < 400; round++) {
      const size = 1 + Math.floor(next() * 6);
      const pins = new Map<number, number>();
      if (next() < 0.5) pins.set(Math.floor(next() * size), Math.floor(next() * size));
      const before: [number, number][] = [];
      if (size > 1 && next() < 0.6) {
        const a = Math.floor(next() * size);
        const b = (a + 1 + Math.floor(next() * (size - 1))) % size;
        before.push([a, b]);
      }
      const problem = problemOf(size, next, { rules: { size, pins, before }, back: next() < 0.4 ? Array.from({ length: size }, () => Math.round(next() * 500)) : null });
      const feasible = permutations(size).filter((p) => obeys(p, problem.rules));
      const solved = solveExact(problem);
      if (feasible.length === 0) {
        expect(solved).toBeNull();
        continue;
      }
      const best = Math.min(...feasible.map((p) => costOf(problem, p)));
      expect(solved).not.toBeNull();
      expect(obeys(solved as number[], problem.rules)).toBe(true);
      expect(costOf(problem, solved as number[])).toBe(best);
    }
  });
});

describe('heuristic solver', () => {
  const budget = (ms: number, seed = 1) => ({ now: () => performance.now(), ms, seed });

  it('finds the optimum on small problems', () => {
    const next = seeded(9);
    for (let round = 0; round < 30; round++) {
      const problem = problemOf(7, next);
      const best = Math.min(...permutations(7).map((p) => costOf(problem, p)));
      expect(costOf(problem, solveHeuristic(problem, budget(200)) as number[])).toBeLessThanOrEqual(best * 1.02);
    }
  });

  it('always returns an order that obeys the rules', () => {
    const next = seeded(21);
    for (let round = 0; round < 40; round++) {
      const size = 20 + Math.floor(next() * 20);
      const pins = new Map<number, number>([[3, 0], [4, size - 1]]);
      const before: [number, number][] = [[5, 6], [7, 8], [8, 9]];
      const problem = problemOf(size, next, { rules: { size, pins, before } });
      const order = solveHeuristic(problem, budget(30)) as number[];
      expect(obeys(order, problem.rules)).toBe(true);
    }
  });

  it('gives the same order for the same seed', () => {
    const problem = problemOf(30, seeded(3));
    const rounds = (): number[] => solveHeuristic(problem, { now: (() => { let t = 0; return () => (t += 1); })(), ms: 4000, seed: 7 }) as number[];
    expect(rounds()).toEqual(rounds());
  });
});

describe('cost of an order', () => {
  const problem = { size: 3, from: [5, 6, 7], between: [[0, 2, 3], [4, 0, 8], [9, 1, 0]], back: [10, 20, 30], rules: { size: 3, pins: new Map<number, number>(), before: [] } };

  it('is zero for no stops', () => {
    expect(costOf(problem, [])).toBe(0);
  });

  it('adds the start leg, the hops and the return leg when there is one', () => {
    expect(costOf(problem, [1, 0, 2])).toBe(6 + 4 + 3 + 30);
    expect(costOf({ ...problem, back: null }, [1, 0, 2])).toBe(6 + 4 + 3);
    expect(costOf(problem, [2])).toBe(7 + 30);
  });
});
