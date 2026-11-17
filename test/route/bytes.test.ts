import fc from 'fast-check';

import { cursorOf, packError } from '../../src/core/route/bytes';

const varint = (value: number): number[] => {
  const out: number[] = [];
  let v = value;
  while (v >= 128) {
    out.push((v % 128) + 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
};

describe('cursorOf', () => {
  it('reads variable length numbers up to 32 bits (property)', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 0xffffffff }), { maxLength: 20 }), (values) => {
      const bytes = Uint8Array.from(values.flatMap(varint));
      const c = cursorOf(bytes, 0, bytes.length);
      for (const v of values) expect(c.u()).toBe(v);
      expect(c.pos()).toBe(bytes.length);
    }));
  });

  it('undoes zigzag signs', () => {
    const values = [0, -1, 1, -2, 2, -1_000_000, 1_000_000];
    const bytes = Uint8Array.from(values.flatMap((v) => varint(v >= 0 ? v * 2 : -v * 2 - 1)));
    const c = cursorOf(bytes, 0, bytes.length);
    expect(values.map(() => c.z())).toEqual(values);
  });

  it('refuses a number that runs off the end, is too long or does not fit 32 bits', () => {
    expect(() => cursorOf(Uint8Array.from([0x80]), 0, 1).u()).toThrow(/truncated/);
    expect(() => cursorOf(Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x01]), 0, 6).u()).toThrow(/too long/);
    expect(() => cursorOf(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0x7f]), 0, 5).u()).toThrow(/too large/);
    expect(() => cursorOf(new Uint8Array(0), 0, 0).u()).toThrow(/truncated/);
  });

  it('works inside a window of a larger buffer and refuses to read beyond it', () => {
    const buf = Uint8Array.from([1, 2, 3, 4]);
    const c = cursorOf(buf, 1, 3);
    expect(c.u()).toBe(2);
    expect(c.end()).toBe(3);
    expect(c.u()).toBe(3);
    expect(() => c.u()).toThrow(/truncated/);
  });

  it('seeks only within its window', () => {
    const c = cursorOf(Uint8Array.from([1, 2, 3, 4]), 1, 3);
    c.seek(2);
    expect(c.u()).toBe(3);
    expect(() => c.seek(0)).toThrow(/seek out of range/);
    expect(() => c.seek(4)).toThrow(/seek out of range/);
  });

  it('refuses a window that does not fit the buffer', () => {
    expect(() => cursorOf(new Uint8Array(4), 0, 5)).toThrow(/section out of range/);
    expect(() => cursorOf(new Uint8Array(4), 3, 2)).toThrow(/section out of range/);
    expect(() => cursorOf(new Uint8Array(4), -1, 2)).toThrow(/section out of range/);
  });
});

describe('packError', () => {
  it('carries a code the callers can test for', () => {
    const error = packError('x') as Error & { code?: string };
    expect(error.message).toBe('route pack: x');
    expect(error.code).toBe('route_pack_corrupt');
  });
});
