import { runHermesGolden } from '../../scripts/hermes-golden';

describe('hermes golden run', () => {
  it('reads the whole golden table the same way in Hermes as in Node (K1.6)', () => {
    const result = runHermesGolden();
    expect(result.error).toBeNull();
    expect(result.total).toBeGreaterThanOrEqual(1500);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
  }, 120_000);

  it('also reads the extra Unicode checks the same way', () => {
    const result = runHermesGolden();
    expect(result.unicode).toEqual({ checked: expect.any(Number), differences: [] });
    expect(result.unicode?.checked).toBeGreaterThan(20);
  }, 120_000);
});
