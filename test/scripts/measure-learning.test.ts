import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIMITS, confirmRun, deliveryVerdict, outlierRun, outlierVerdict, pinVerdict, pooled, prepareEnv, prepareSparse, sparseRun, sparseVerdict, tableOf, runCheck, type Source } from '../../scripts/measure-learning';
import { builtPack, memoryStore, turkeyBorders } from '../address/helpers/search-fixture';

const stats = (median: number, p90 = median, n = 10) => ({ n, mean: median, median, p90 });

describe('the verdicts', () => {
  it('passes one delivery on the edge of 16 m and fails just over', () => {
    expect(deliveryVerdict(1, stats(16))).toBe(true);
    expect(deliveryVerdict(1, stats(16.1))).toBe(false);
  });

  it('wants both the median and the 90th percentile after three deliveries', () => {
    expect(deliveryVerdict(3, stats(10, 22))).toBe(true);
    expect(deliveryVerdict(3, stats(10.1, 22))).toBe(false);
    expect(deliveryVerdict(3, stats(10, 22.1))).toBe(false);
  });

  it('passes five deliveries on the edge of 8 m', () => {
    expect(deliveryVerdict(5, stats(8))).toBe(true);
    expect(deliveryVerdict(5, stats(8.1))).toBe(false);
  });

  it('never passes an empty set', () => {
    for (const n of [1, 3, 5] as const) expect(deliveryVerdict(n, stats(0, 0, 0))).toBe(false);
    expect(pinVerdict(stats(0, 0, 0))).toBe(false);
    expect(outlierVerdict([]).pass).toBe(false);
    expect(sparseVerdict(stats(1, 1, 0), stats(10))).toEqual({ pass: false, gain: 0 });
    expect(sparseVerdict(stats(1), stats(10, 10, 0))).toEqual({ pass: false, gain: 0 });
  });

  it('passes a pin on the edge of 6 m', () => {
    expect(pinVerdict(stats(6))).toBe(true);
    expect(pinVerdict(stats(6.1))).toBe(false);
  });

  it('wants ninety nine in a hundred outlier cases within three metres', () => {
    const ok = Array.from({ length: 100 }, (_, i) => (i === 0 ? 3.1 : 3));
    expect(outlierVerdict(ok)).toEqual({ pass: true, share: 0.99 });
    const bad = Array.from({ length: 100 }, (_, i) => (i < 2 ? 3.1 : 0));
    expect(outlierVerdict(bad).pass).toBe(false);
  });

  it('wants both a 25 m median and a halved error on a sparse province', () => {
    expect(sparseVerdict(stats(25), stats(50))).toEqual({ pass: true, gain: 0.5 });
    expect(sparseVerdict(stats(25.1), stats(100)).pass).toBe(false);
    expect(sparseVerdict(stats(20), stats(39)).pass).toBe(false);
    expect(sparseVerdict(stats(1), stats(0)).pass).toBe(false);
  });

  it('keeps the numbers of the plan', () => {
    expect(LIMITS).toEqual({ first: 16, third: { median: 10, p90: 22 }, fifth: 8, pin: 6, outlierDiffM: 3, outlierShare: 0.99, sparseMedian: 25, sparseGain: 0.5 });
  });
});

describe('the runs on a small pack', () => {
  let work = '';
  let source: Source;
  beforeAll(async () => {
    work = mkdtempSync(join(tmpdir(), 'geo-ml-'));
    const file = await builtPack();
    const { store } = await memoryStore({ '34': file });
    source = { plate: '34', file, base: store, borders: turkeyBorders() };
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it('prepares an environment with hidden doors and targets', async () => {
    const env = await prepareEnv(source, work, { share: 0.5 });
    expect(env.hiddenCount).toBeGreaterThan(5);
    expect(env.targets.length).toBeGreaterThan(0);
    expect(env.targets.length).toBeLessThanOrEqual(env.hiddenCount);
    const limited = await prepareEnv(source, work, { share: 0.5, limit: 3 });
    expect(limited.targets).toHaveLength(3);
    expect((await prepareEnv(source, work, { share: 0.5 })).targets.map((t) => t.door.id)).toEqual(env.targets.map((t) => t.door.id));
  });

  it('brings a pin error down to a few metres', async () => {
    const env = await prepareEnv(source, work, { share: 0.5 });
    const run = await confirmRun(env, 'pin', 1);
    expect(run.after.length).toBeGreaterThan(0);
    expect(run.before).toHaveLength(run.after.length);
    expect(run.learned).toBe(run.after.length);
    expect(pooled([run], 'after').median).toBeLessThan(8);
  });

  it('counts deliveries with outliers in the error', async () => {
    const env = await prepareEnv(source, work, { share: 0.5 });
    const one = await confirmRun(env, 'delivery', 1);
    const five = await confirmRun(env, 'delivery', 5);
    expect(pooled([five], 'after').median).toBeLessThanOrEqual(pooled([one], 'after').median + 5);
  });

  it('measures how little a 300 m outlier moves a point held by two clean ones', async () => {
    const env = await prepareEnv(source, work, { share: 0.5 });
    const diffs = await outlierRun(env);
    expect(diffs.length).toBeGreaterThan(0);
    expect(Math.max(...diffs)).toBeLessThan(0.01);
  });

  it('builds a sparse province and learns a share of its numbers', async () => {
    const env = await prepareSparse(source, work);
    expect(env.learn.length).toBeGreaterThanOrEqual(2);
    expect(env.targets.length).toBeGreaterThan(0);
    const ids = new Set(env.learn.map((t) => t.door.id));
    expect(env.targets.every((t) => !ids.has(t.door.id))).toBe(true);
    const run = await sparseRun(env, 'all');
    expect(run.after.length).toBeGreaterThan(0);
    expect(run.learned).toBeGreaterThan(0);
    const trusted = await sparseRun(env, 'trusted');
    expect(trusted.after).toHaveLength(trusted.before.length);
  });

  it('draws a table with one row per province and a total', async () => {
    const env = await prepareEnv(source, work, { share: 0.5 });
    const run = await confirmRun(env, 'pin', 1);
    const table = tableOf(['34'], [run]);
    expect(table.split('\n')).toHaveLength(4);
    expect(table).toContain('| 34 |');
    expect(table).toContain('| toplam |');
  });

  it('refuses a check it does not know', async () => {
    expect(await runCheck('nothing')).toBeNull();
  });
});
