import { equalBytes, seededBytes, seededBytesAsync } from '../../scripts/spikes/blob';
import { benchPoints, dijkstraTargets, makeGridGraph, makeGridGraphAsync, matrix, matrixAsync, runBench } from '../../scripts/spikes/graph';
import { makeYielder } from '../../scripts/spikes/yielder';

describe('makeYielder', () => {
  it('only yields when the interval has passed', async () => {
    let clock = 0;
    let waits = 0;
    const yielder = makeYielder({ now: () => clock, wait: async () => void waits++, everyMs: 50 });
    await yielder();
    clock = 49;
    await yielder();
    expect(waits).toBe(0);
    clock = 50;
    await yielder();
    expect(waits).toBe(1);
    clock = 99;
    await yielder();
    expect(waits).toBe(1);
    clock = 100;
    await yielder();
    expect(waits).toBe(2);
  });

  it('yields every time with a zero interval', async () => {
    let waits = 0;
    const yielder = makeYielder({ now: () => 0, wait: async () => void waits++, everyMs: 0 });
    await yielder();
    await yielder();
    expect(waits).toBe(2);
  });
});

describe('seededBytesAsync', () => {
  it('matches the sync stream and yields between blocks', async () => {
    let waits = 0;
    const bytes = await seededBytesAsync(42, 3 * 1024 * 1024 + 5, async () => void waits++);
    expect(equalBytes(bytes, seededBytes(42, 3 * 1024 * 1024 + 5))).toBe(true);
    expect(waits).toBeGreaterThanOrEqual(3);
  });
});

describe('makeGridGraphAsync', () => {
  it('builds exactly the sync graph and yields along the way', async () => {
    let waits = 0;
    const sync = makeGridGraph(40, 9);
    const async_ = await makeGridGraphAsync(40, 9, async () => void waits++);
    expect(Array.from(async_.firstEdge)).toEqual(Array.from(sync.firstEdge));
    expect(Array.from(async_.target)).toEqual(Array.from(sync.target));
    expect(Array.from(async_.weight)).toEqual(Array.from(sync.weight));
    expect(waits).toBeGreaterThan(1);
  });
});

describe('matrixAsync', () => {
  it('returns the sync matrix, yields per source and reports compute time only', async () => {
    const g = makeGridGraph(30, 4);
    const sources = Uint32Array.of(0, 11, 200, 455, 899);
    const targets = Uint32Array.of(5, 300, 700);
    let waits = 0;
    let clock = 0;
    const result = await matrixAsync(g, sources, targets, {
      yieldNow: async () => {
        waits++;
        clock += 1000;
      },
      now: () => clock,
    });
    expect(Array.from(result.values)).toEqual(Array.from(matrix(g, sources, targets)));
    expect(waits).toBe(sources.length);
    expect(result.computeMs).toBe(0);
    expect(Array.from(dijkstraTargets(g, 0, targets))).toEqual(Array.from(result.values.subarray(0, 3)));
  });
});

describe('benchPoints', () => {
  it('picks the points runBench uses, so both paths share one checksum', () => {
    const g = makeGridGraph(25, 1);
    const { sources, targets } = benchPoints(g, 1, 10);
    const direct = matrix(g, sources, targets).reduce((sum, v) => sum + (Number.isFinite(v) ? v : 0), 0);
    expect(runBench({ side: 25, seed: 1, points: 10, repetitions: 1, now: () => 0 }).checksum).toBe(direct);
  });
});
