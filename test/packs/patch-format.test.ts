import { buildPatch, PATCH_HEADER_BYTES, PATCH_MAGIC, PATCH_SLICE_BYTES, readPatchIndex, type PatchPart } from '../../src/core/packs/patch';

const frame = (n: number, fill = 7): Uint8Array => new Uint8Array(n).fill(fill);
const parts = (): PatchPart[] => [
  { length: 100, refStart: 0, refLength: 150, frame: frame(10, 1) },
  { length: 100, refStart: 50, refLength: 200, frame: frame(20, 2) },
  { length: 30, refStart: 120, refLength: 180, frame: frame(5, 3) },
];

describe('the patch file format', () => {
  it('reads back what it wrote, with the frames where the index says', () => {
    const bytes = buildPatch(230, 300, parts());
    const index = readPatchIndex(bytes);
    expect(index).not.toBeNull();
    expect(index).toMatchObject({ newSize: 230, oldSize: 300 });
    expect(index?.slices.map((s) => [s.length, s.refStart, s.refLength, s.frameSize])).toEqual([[100, 0, 150, 10], [100, 50, 200, 20], [30, 120, 180, 5]]);
    const first = index!.slices[0]!;
    expect(first.frameOffset).toBe(PATCH_HEADER_BYTES + 3 * PATCH_SLICE_BYTES);
    expect(index!.slices.map((s) => bytes[s.frameOffset])).toEqual([1, 2, 3]);
    expect(index!.slices[2]!.frameOffset + 5).toBe(bytes.length);
  });

  it('starts with the YGPT magic, version 1 and zero flags', () => {
    const bytes = buildPatch(230, 300, parts());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(PATCH_MAGIC);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('YGPT');
    expect(view.getUint16(4, true)).toBe(1);
    expect(view.getUint16(6, true)).toBe(0);
  });

  it('accepts an empty reference', () => {
    const bytes = buildPatch(10, 0, [{ length: 10, refStart: 0, refLength: 0, frame: frame(3) }]);
    expect(readPatchIndex(bytes)?.slices[0]?.refLength).toBe(0);
  });

  it('refuses a header with nothing to build, even when it adds up', () => {
    expect(readPatchIndex(buildPatch(0, 300, []))).toBeNull();
  });

  it('refuses a slice of zero length or a frame of zero size even when the totals add up', () => {
    const [a, b, c] = parts() as [PatchPart, PatchPart, PatchPart];
    expect(readPatchIndex(buildPatch(230, 300, [a, { ...b, length: 0 }, { ...c, length: 130 }]))).toBeNull();
    expect(readPatchIndex(buildPatch(230, 300, [a, { ...b, frame: new Uint8Array(0) }, c]))).toBeNull();
  });

  it('accepts a reference that ends exactly at the end of the old file', () => {
    expect(readPatchIndex(buildPatch(10, 100, [{ length: 10, refStart: 60, refLength: 40, frame: frame(3) }]))).not.toBeNull();
    expect(readPatchIndex(buildPatch(10, 100, [{ length: 10, refStart: 60, refLength: 41, frame: frame(3) }]))).toBeNull();
  });

  const good = (): Uint8Array => buildPatch(230, 300, parts());
  const poke = (change: (view: DataView, bytes: Uint8Array) => void): Uint8Array => {
    const bytes = good().slice();
    change(new DataView(bytes.buffer), bytes);
    return bytes;
  };

  it.each([
    ['too short for the header', () => good().slice(0, 10)],
    ['a wrong magic', () => poke((v) => v.setUint32(0, 1, true))],
    ['a newer version', () => poke((v) => v.setUint16(4, 2, true))],
    ['flags set', () => poke((v) => v.setUint16(6, 1, true))],
    ['no slices', () => poke((v) => v.setUint32(16, 0, true))],
    ['a zero new size', () => poke((v) => v.setUint32(8, 0, true))],
    ['more slices than the file holds', () => poke((v) => v.setUint32(16, 1000, true))],
    ['a slice of zero length', () => poke((v) => v.setUint32(PATCH_HEADER_BYTES, 0, true))],
    ['a frame of zero size', () => poke((v) => v.setUint32(PATCH_HEADER_BYTES + 12, 0, true))],
    ['a reference outside the old file', () => poke((v) => v.setUint32(PATCH_HEADER_BYTES + 8, 400, true))],
    ['lengths that do not add up to the new size', () => poke((v) => v.setUint32(8, 231, true))],
    ['frames that stop short of the end', () => good().slice(0, good().length - 1)],
    ['frames that run past the end', () => new Uint8Array([...good(), 0])],
  ])('refuses %s', (_name, make) => {
    expect(readPatchIndex(make())).toBeNull();
  });
});
