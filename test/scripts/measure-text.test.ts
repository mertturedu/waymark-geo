import { THRESHOLDS, runCheck } from '../../scripts/measure-text';

describe('measure-text', () => {
  it('passes the frozen golden table', () => {
    const outcome = runCheck('golden');
    expect(outcome.pass).toBe(true);
    expect(outcome.measured).toMatch(/^\d+\/\d+$/);
  });

  it('measures speed and reports the numbers (the strict limits are judged by the gate run)', () => {
    const outcome = runCheck('speed');
    expect(outcome.measured).toMatch(/p99 .* ms, en uzun .* ms, ilk çağrı .* ms/);
    expect(outcome.detail).toMatchObject({ calls: 20000 });
    expect(THRESHOLDS.speedP99Ms).toBe(2);
    expect(THRESHOLDS.speedMaxMs).toBe(50);
  });

  it('runs a short fuzz and reports the count', () => {
    const outcome = runCheck('fuzz', { fuzzCount: 2000 });
    expect(outcome.pass).toBe(true);
    expect(outcome.measured).toBe('2000 girdi, 0 hata, 0 bozuk sonuç');
  });

  it('passes K1.5 on a seed the parser was not fitted to', () => {
    const outcome = runCheck('k15', { k15Seed: 424242 });
    expect(outcome.pass).toBe(true);
    expect(THRESHOLDS.k15).toBe(0.98);
    expect(outcome.detail).toMatchObject({ total: 5000 });
  });

  it('reports a failing K1.5 when the threshold is not met', () => {
    const outcome = runCheck('k15', { k15Seed: 424242 });
    const detail = outcome.detail as { rate: number; byLang: Record<string, { rate: number }>; byProvince: Record<string, { total: number }> };
    expect(detail.rate).toBeGreaterThanOrEqual(0.98);
    expect(Object.keys(detail.byLang).sort()).toEqual(['ar', 'de', 'el', 'en', 'ru', 'tr']);
    expect(Object.keys(detail.byProvince)).toHaveLength(12);
  });
});
