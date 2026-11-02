import { equalBytes, seededBytes } from '../../scripts/spikes/blob';
import { seededBlob } from '../../scripts/make-test-data';

describe('seededBytes', () => {
  it('is deterministic, sized exactly and seed dependent', () => {
    const a = seededBytes(42, 1001);
    expect(a).toHaveLength(1001);
    expect(equalBytes(a, seededBytes(42, 1001))).toBe(true);
    expect(equalBytes(a, seededBytes(43, 1001))).toBe(false);
  });

  it('keeps the first bytes stable when the size grows', () => {
    expect(equalBytes(seededBytes(7, 100), seededBytes(7, 5000).subarray(0, 100))).toBe(true);
  });

  it('is the same stream the test data builder writes to disk', () => {
    expect(equalBytes(seededBytes(42, 4097), seededBlob(42, 4097))).toBe(true);
  });
});

describe('equalBytes', () => {
  it('compares length and every byte', () => {
    expect(equalBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3))).toBe(true);
    expect(equalBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2))).toBe(false);
    expect(equalBytes(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 4))).toBe(false);
    expect(equalBytes(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });

  it('handles lengths that are not a multiple of four and unaligned views', () => {
    const base = seededBytes(5, 64);
    expect(equalBytes(base.subarray(1, 62), seededBytes(5, 64).subarray(1, 62))).toBe(true);
    const changed = seededBytes(5, 64);
    changed[61] = (changed[61] as number) ^ 1;
    expect(equalBytes(base.subarray(1, 62), changed.subarray(1, 62))).toBe(false);
  });
});
