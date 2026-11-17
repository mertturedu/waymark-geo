import { feasibleOrder, obeys, type Rules } from '../../src/core/plan/rules';

const rules = (size: number, pins: [number, number][] = [], before: [number, number][] = []): Rules => ({ size, pins: new Map(pins), before });

function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  return permutations(n - 1).flatMap((p) => Array.from({ length: p.length + 1 }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

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

describe('feasibleOrder', () => {
  it('returns an empty order for no stops', () => {
    expect(feasibleOrder(rules(0))).toEqual([]);
  });

  it('puts a pinned stop in its slot and keeps precedence', () => {
    const order = feasibleOrder(rules(4, [[2, 0]], [[1, 3]])) as number[];
    expect(order[0]).toBe(2);
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(3));
  });

  it('rejects two stops pinned to one slot, a slot outside the list and a precedence cycle', () => {
    expect(feasibleOrder(rules(3, [[0, 1], [1, 1]]))).toBeNull();
    expect(feasibleOrder(rules(3, [[0, 3]]))).toBeNull();
    expect(feasibleOrder(rules(3, [], [[0, 1], [1, 2], [2, 0]]))).toBeNull();
  });

  it('rejects a pin that breaks a precedence', () => {
    expect(feasibleOrder(rules(3, [[0, 2], [1, 0]], [[0, 1]]))).toBeNull();
  });

  it('agrees with brute force on random small rules', () => {
    const next = seeded(11);
    for (let round = 0; round < 3000; round++) {
      const size = 1 + Math.floor(next() * 6);
      const pins: [number, number][] = [];
      const used = new Set<number>();
      for (let i = 0; i < size; i++) if (next() < 0.35) pins.push([i, Math.floor(next() * (size + 1))]);
      for (const [, slot] of pins) used.add(slot);
      const before: [number, number][] = [];
      for (let k = 0; k < Math.floor(next() * 4); k++) {
        const a = Math.floor(next() * size);
        const b = Math.floor(next() * size);
        if (a !== b) before.push([a, b]);
      }
      const set = rules(size, pins, before);
      const exists = permutations(size).some((p) => obeys(p, set));
      const found = feasibleOrder(set);
      expect(found !== null).toBe(exists);
      if (found) expect(obeys(found, set)).toBe(true);
    }
  });
});
