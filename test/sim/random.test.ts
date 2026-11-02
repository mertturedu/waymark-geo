import { normal, rng, shuffle } from './random';

describe('rng', () => {
  it('gives the same numbers for the same seed and other numbers for another', () => {
    const a = rng(7);
    const b = rng(7);
    const c = rng(8);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(first);
  });

  it('stays in [0, 1) and spreads evenly', () => {
    const r = rng(1);
    const values = Array.from({ length: 20000 }, () => r());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.49);
    expect(mean).toBeLessThan(0.51);
  });
});

describe('shuffle', () => {
  it('keeps every item, leaves the input alone and is repeatable', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = shuffle(input, rng(3));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(input[0]).toBe(0);
    expect(shuffle(input, rng(3))).toEqual(out);
    expect(out).not.toEqual(input);
    expect(shuffle([], rng(1))).toEqual([]);
    expect(shuffle([9], rng(1))).toEqual([9]);
  });
});

describe('normal', () => {
  it('has the asked mean and spread', () => {
    const r = rng(11);
    const values = Array.from({ length: 40000 }, () => normal(r, 10));
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
    expect(Math.abs(mean)).toBeLessThan(0.2);
    expect(sd).toBeGreaterThan(9.8);
    expect(sd).toBeLessThan(10.2);
  });

  it('survives a generator that returns zero', () => {
    const zeros = [0, 0.25];
    let i = 0;
    expect(Number.isFinite(normal(() => zeros[i++ % 2] as number, 5))).toBe(true);
  });
});
