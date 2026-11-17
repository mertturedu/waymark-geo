import profile from '../../src/core/traffic/data/ibb-istanbul.json';
import { encodeSlowdowns, geohash, observedSlowdown, type ObservedProfile } from '../../src/core/traffic/observed';

const istanbul = profile as ObservedProfile;
const TUESDAY_18 = Date.UTC(2026, 10, 17, 15, 0);
const TUESDAY_03 = Date.UTC(2026, 10, 17, 0, 0);

describe('observed traffic profile', () => {
  it('encodes geohashes the standard way', () => {
    expect(geohash(57.64911, 10.40744, 11)).toBe('u4pruydqqvj');
    expect(geohash(41.0971069, 29.0203857, 6)).toBe('sxk9u3');
  });

  it('round-trips slowdowns through the alphabet and keeps gaps', () => {
    const text = encodeSlowdowns([0, 0.5, 1, null], 35);
    expect(text).toHaveLength(4);
    expect(text.endsWith('-')).toBe(true);
    const tiny: ObservedProfile = { precision: 6, levels: 35, cells: { sxk9u3: text.padEnd(72, '0') } };
    expect(observedSlowdown(tiny, 41.0971, 29.0203, Date.UTC(2026, 10, 16, 22, 0))).toBeCloseTo(0.5, 1);
  });

  it('is much slower at the evening peak than at night in a busy Istanbul cell', () => {
    const peak = observedSlowdown(istanbul, 41.0971069, 29.0203857, TUESDAY_18) as number;
    const night = observedSlowdown(istanbul, 41.0971069, 29.0203857, TUESDAY_03) as number;
    expect(peak).toBeGreaterThan(0.5);
    expect(night).toBeLessThan(0.3);
  });

  it('knows nothing outside the covered area', () => {
    expect(observedSlowdown(istanbul, 39.92, 32.85, TUESDAY_18)).toBeNull();
  });
});
