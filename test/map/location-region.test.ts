import { ageMs, movedEnough, nextReadMs, REREAD_MS, RETRY_FIX_MS, timestampMs } from '../../src/native/logic/location-region';

describe('location region refresh', () => {
  it('always accepts the first position', () => {
    expect(movedEnough(null, [29, 41])).toBe(true);
  });

  it('ignores small moves and accepts moves past the threshold', () => {
    expect(movedEnough([29, 41], [29.001, 41.001])).toBe(false);
    expect(movedEnough([29, 41], [29.03, 41.03])).toBe(true);
    expect(movedEnough([29, 41], [29.01, 41], 500)).toBe(true);
  });

  it('reads again soon after a missed fix and slowly after a good one', () => {
    expect(nextReadMs(true)).toBe(REREAD_MS);
    expect(nextReadMs(false)).toBe(RETRY_FIX_MS);
    expect(RETRY_FIX_MS).toBeLessThan(REREAD_MS);
  });
});

describe('position timestamps', () => {
  it('reads iOS seconds and Android milliseconds alike', () => {
    const now = 1_793_650_000_000;
    expect(timestampMs(1_793_649_990)).toBe(1_793_649_990_000);
    expect(timestampMs(1_793_649_990_000)).toBe(1_793_649_990_000);
    expect(ageMs(1_793_649_990, now)).toBe(10_000);
    expect(ageMs(1_793_649_990_000, now)).toBe(10_000);
  });

  it('treats a missing or broken timestamp as very old, never as fresh', () => {
    const now = 1_793_650_000_000;
    expect(ageMs(0, now)).toBe(now);
    expect(ageMs(Number.NaN, now)).toBe(now);
    expect(ageMs(Number.POSITIVE_INFINITY, now)).toBe(now);
  });
});
