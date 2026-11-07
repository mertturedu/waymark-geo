export const PATCH_MAGIC = 0x54504759;
export const PATCH_VERSION = 1;
export const PATCH_HEADER_BYTES = 20;
export const PATCH_SLICE_BYTES = 16;

export type PatchSlice = { length: number; refStart: number; refLength: number; frameOffset: number; frameSize: number };
export type PatchIndex = { newSize: number; oldSize: number; slices: PatchSlice[] };

const u32 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
const u16 = (bytes: Uint8Array, at: number): number => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(at, true);

export const patchIndexBytes = (head: Uint8Array): number | null => (head.length < PATCH_HEADER_BYTES || u32(head, 0) !== PATCH_MAGIC ? null : PATCH_HEADER_BYTES + u32(head, 16) * PATCH_SLICE_BYTES);

export function readPatchIndex(bytes: Uint8Array, total: number = bytes.length): PatchIndex | null {
  if (bytes.length < PATCH_HEADER_BYTES) return null;
  if (u32(bytes, 0) !== PATCH_MAGIC || u16(bytes, 4) !== PATCH_VERSION || u16(bytes, 6) !== 0) return null;
  const newSize = u32(bytes, 8);
  const oldSize = u32(bytes, 12);
  const count = u32(bytes, 16);
  const framesAt = PATCH_HEADER_BYTES + count * PATCH_SLICE_BYTES;
  if (count === 0 || framesAt > bytes.length || framesAt > total) return null;
  const slices: PatchSlice[] = [];
  let produced = 0;
  let frameOffset = framesAt;
  for (let i = 0; i < count; i++) {
    const at = PATCH_HEADER_BYTES + i * PATCH_SLICE_BYTES;
    const slice: PatchSlice = { length: u32(bytes, at), refStart: u32(bytes, at + 4), refLength: u32(bytes, at + 8), frameOffset, frameSize: u32(bytes, at + 12) };
    if (slice.length === 0 || slice.frameSize === 0 || slice.refStart + slice.refLength > oldSize) return null;
    produced += slice.length;
    frameOffset += slice.frameSize;
    slices.push(slice);
  }
  if (produced !== newSize || frameOffset !== total) return null;
  return { newSize, oldSize, slices };
}

export type PatchPart = { length: number; refStart: number; refLength: number; frame: Uint8Array };

export function buildPatch(newSize: number, oldSize: number, parts: ReadonlyArray<PatchPart>): Uint8Array {
  const frames = parts.reduce((sum, part) => sum + part.frame.length, 0);
  const out = new Uint8Array(PATCH_HEADER_BYTES + parts.length * PATCH_SLICE_BYTES + frames);
  const view = new DataView(out.buffer);
  view.setUint32(0, PATCH_MAGIC, true);
  view.setUint16(4, PATCH_VERSION, true);
  view.setUint32(8, newSize, true);
  view.setUint32(12, oldSize, true);
  view.setUint32(16, parts.length, true);
  let frameAt = PATCH_HEADER_BYTES + parts.length * PATCH_SLICE_BYTES;
  parts.forEach((part, i) => {
    const at = PATCH_HEADER_BYTES + i * PATCH_SLICE_BYTES;
    view.setUint32(at, part.length, true);
    view.setUint32(at + 4, part.refStart, true);
    view.setUint32(at + 8, part.refLength, true);
    view.setUint32(at + 12, part.frame.length, true);
    out.set(part.frame, frameAt);
    frameAt += part.frame.length;
  });
  return out;
}
