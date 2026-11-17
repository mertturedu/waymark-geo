import fc from 'fast-check';
import { constants, zstdCompressSync } from 'node:zlib';
import { Decompress, decompress } from '../../src/core/packs/fzstd';
import { createZstdDecode } from '../../src/core/packs/zstd';

const pack = (bytes: Uint8Array, windowLog: number, level = 9): Uint8Array =>
  new Uint8Array(zstdCompressSync(bytes, { params: { [constants.ZSTD_c_compressionLevel]: level, [constants.ZSTD_c_windowLog]: windowLog, [constants.ZSTD_c_checksumFlag]: 1 } }));

function stream(packed: Uint8Array, chunk: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const decoder = new Decompress((data) => void parts.push(data));
  for (let at = 0; at < packed.length; at += chunk) decoder.push(packed.subarray(at, at + chunk), at + chunk >= packed.length);
  return Buffer.concat(parts);
}

function sample(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed || 1;
  const next = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
  for (let at = 0; at < length; ) {
    if (at > 64 && next() % 3 > 0) {
      const back = 1 + (next() % Math.min(at, 300_000));
      const run = Math.min(length - at, 4 + (next() % 200));
      for (let i = 0; i < run; i++, at++) out[at] = out[at - back] as number;
    } else out[at++] = next() % 251;
  }
  return out;
}

describe('fzstd stream with a double window', () => {
  it('opens data many times larger than its window, in any chunk size', () => {
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 18 }), fc.integer({ min: 1_000, max: 400_000 }), fc.integer({ min: 1, max: 90_000 }), fc.integer({ min: 1, max: 2 ** 30 }), (windowLog, length, chunk, seed) => {
        const bytes = sample(length, seed);
        expect(Buffer.from(stream(pack(bytes, windowLog), chunk)).equals(Buffer.from(bytes))).toBe(true);
      }),
      { numRuns: 60 },
    );
  });

  it('opens frames one after another, each with its own window', () => {
    const parts = [sample(70_000, 3), sample(250_000, 9), sample(5, 11)];
    const packed = Buffer.concat([pack(parts[0] as Uint8Array, 10), pack(parts[1] as Uint8Array, 16), pack(parts[2] as Uint8Array, 12)]);
    for (const chunk of [1, 777, 65_536, packed.length]) expect(Buffer.from(stream(packed, chunk)).equals(Buffer.concat(parts))).toBe(true);
  });

  it('gives the same bytes as the one shot decoder and the port the SDK uses', () => {
    const bytes = sample(600_000, 42);
    const packed = pack(bytes, 17, 19);
    expect(Buffer.from(decompress(packed)).equals(Buffer.from(bytes))).toBe(true);
    const port = createZstdDecode().zstd();
    const pieces: Uint8Array[] = [];
    for (let at = 0; at < packed.length; at += 256 * 1024) pieces.push(...port.push(packed.subarray(at, at + 256 * 1024), at + 256 * 1024 >= packed.length));
    expect(Buffer.concat(pieces).equals(Buffer.from(bytes))).toBe(true);
  });

  it('still refuses broken data', () => {
    const packed = pack(sample(50_000, 5), 12);
    expect(() => stream(packed.subarray(0, packed.length - 9), 4096)).toThrow();
    expect(() => stream(Uint8Array.from({ length: 300 }, (_, i) => i & 255), 64)).toThrow();
  });
});
