import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decompressInPlaceSteps, decompressPrefix } from '../../src/core/packs/fzstd';
import { applyPatchFile, type PatchInput } from '../../src/core/packs/patch-apply';
import { encodePatch, zstdPatchTool } from '../../pipeline/build/patches';
import { createFakeEnv, type FakeEnv } from '../helpers/fake-env';

const shape = { segment: 64 * 1024, margin: 32 * 1024 };
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const noise = (length: number, seed = 'a'): Buffer => {
  const parts: Buffer[] = [];
  let total = 0;
  for (let i = 0; total < length; i++) {
    const part = createHash('sha256').update(`${seed}${i}`).digest();
    parts.push(part);
    total += part.length;
  }
  return Buffer.concat(parts).subarray(0, length);
};
const edited = (source: Buffer, at: number, patch: Buffer, drop = patch.length): Buffer => Buffer.concat([source.subarray(0, at), patch, source.subarray(at + drop)]);

const roots: string[] = [];
afterAll(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const OLD = noise(400_000);
const NEW = edited(OLD, 150_000, noise(90_000, 'ins'), 0);

async function patchOf(older: Buffer, newer: Buffer): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'apply-'));
  roots.push(dir);
  return (await encodePatch(older, newer, zstdPatchTool, dir, shape))!;
}

let cached: Uint8Array | undefined;
const goodPatch = async (): Promise<Uint8Array> => (cached ??= await patchOf(OLD, NEW));

function rig(old: Uint8Array | null, patch: Uint8Array | null): { env: FakeEnv; input: PatchInput; paused: () => number } {
  const env = createFakeEnv();
  if (old) env.fs.files.set('/old', old);
  if (patch) env.fs.files.set('/patch', patch);
  let pauses = 0;
  const input: PatchInput = { fs: env.fs, hash: env.hash, oldPath: '/old', patchPath: '/patch', outPath: '/out', sha256: sha(NEW), pause: async () => void (pauses += 1) };
  return { env, input, paused: () => pauses };
}

describe('applyPatchFile', () => {
  it('builds the new file next to the old one and checks its hash', async () => {
    const { env, input } = rig(OLD, await goodPatch());
    const progress: [number, number][] = [];
    const result = await applyPatchFile({ ...input, onProgress: (done, total) => progress.push([done, total]) });
    expect(result).toEqual({ ok: true, bytes: NEW.length, slices: Math.ceil(NEW.length / shape.segment) });
    expect(Buffer.from(env.fs.files.get('/out')!).equals(NEW)).toBe(true);
    expect(env.fs.files.get('/old')).toBe(OLD);
    expect(progress[progress.length - 1]).toEqual([NEW.length, NEW.length]);
    for (let i = 1; i < progress.length; i++) expect(progress[i]![0]).toBeGreaterThan(progress[i - 1]![0]);
  });

  it('starts from an empty output even if a half written one is there', async () => {
    const { env, input } = rig(OLD, await goodPatch());
    env.fs.files.set('/out', new Uint8Array([1, 2, 3]));
    expect((await applyPatchFile(input)).ok).toBe(true);
    expect(sha(env.fs.files.get('/out')!)).toBe(sha(NEW));
  });

  it('lets the engine breathe between slices and, with a tight budget, between blocks', async () => {
    const calm = rig(OLD, await goodPatch());
    await applyPatchFile(calm.input);
    expect(calm.paused()).toBeGreaterThanOrEqual(Math.ceil(NEW.length / shape.segment));
    const tight = rig(OLD, await goodPatch());
    let clock = 0;
    await applyPatchFile({ ...tight.input, now: () => (clock += 1), budgetMs: 1 });
    expect(tight.paused()).toBeGreaterThan(calm.paused());
  });

  it('rebuilds a file that grew far beyond the old one (slices without a reference)', async () => {
    const small = OLD.subarray(0, 50_000);
    const big = Buffer.concat([small, noise(300_000, 'tail')]);
    const { env, input } = rig(small, await patchOf(small, big));
    expect(await applyPatchFile({ ...input, sha256: sha(big) })).toMatchObject({ ok: true });
    expect(sha(env.fs.files.get('/out')!)).toBe(sha(big));
  });

  it('reads in small chunks and builds the same file', async () => {
    const { env, input } = rig(OLD, await goodPatch());
    const sizes: number[] = [];
    const watching = { ...env.fs, read: async (path: string, offset: number, length: number) => (sizes.push(length), env.fs.read(path, offset, length)) };
    expect(await applyPatchFile({ ...input, fs: watching, chunkBytes: 7_000 })).toMatchObject({ ok: true });
    expect(sha(env.fs.files.get('/out')!)).toBe(sha(NEW));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(7_000);
    expect(sizes.filter((size) => size === 7_000).length).toBeGreaterThan(10);
  });

  it('refuses when a read comes back short in the middle of a slice, in either file', async () => {
    const patch = await goodPatch();
    for (const target of ['/old', '/patch']) {
      const { env, input } = rig(OLD, patch);
      let calls = 0;
      const flaky = { ...env.fs, read: async (path: string, offset: number, length: number) => (path === target && offset > 100 && length === 5_000 && ++calls === 3 ? new Uint8Array(length - 1) : env.fs.read(path, offset, length)) };
      const result = await applyPatchFile({ ...input, fs: flaky, chunkBytes: 5_000 });
      expect(result).toEqual({ ok: false, reason: target === '/old' ? 'old' : 'patch' });
    }
  });

  it('refuses when the patch is missing, too short or has a damaged index', async () => {
    const patch = await goodPatch();
    expect(await applyPatchFile(rig(OLD, null).input)).toEqual({ ok: false, reason: 'patch' });
    expect(await applyPatchFile(rig(OLD, patch.subarray(0, 10)).input)).toEqual({ ok: false, reason: 'patch' });
    expect(await applyPatchFile(rig(OLD, patch.subarray(0, patch.length - 1)).input)).toEqual({ ok: false, reason: 'patch' });
    const noMagic = patch.slice();
    noMagic[0] = 0;
    expect(await applyPatchFile(rig(OLD, noMagic).input)).toEqual({ ok: false, reason: 'patch' });
    const absurd = patch.slice();
    new DataView(absurd.buffer).setUint32(16, 1_000_000, true);
    expect(await applyPatchFile(rig(OLD, absurd).input)).toEqual({ ok: false, reason: 'patch' });
  });

  it('refuses when the old file is missing or is not the one the patch was made from', async () => {
    const patch = await goodPatch();
    expect(await applyPatchFile(rig(null, patch).input)).toEqual({ ok: false, reason: 'old' });
    expect(await applyPatchFile(rig(OLD.subarray(1), patch).input)).toEqual({ ok: false, reason: 'old' });
  });

  it('refuses a file that comes out different, and leaves no output behind', async () => {
    const patch = await goodPatch();
    const { env, input } = rig(edited(OLD, 10, Buffer.from([9])), patch);
    const result = await applyPatchFile(input);
    expect(result.ok).toBe(false);
    expect(env.fs.files.has('/out')).toBe(false);
    const wrong = rig(OLD, patch);
    expect(await applyPatchFile({ ...wrong.input, sha256: '0'.repeat(64) })).toEqual({ ok: false, reason: 'sha256' });
    expect(wrong.env.fs.files.has('/out')).toBe(false);
  });

  it('refuses a patch whose frames are damaged', async () => {
    const patch = (await goodPatch()).slice();
    for (let i = patch.length - 400; i < patch.length - 300; i++) patch[i] = (patch[i] as number) ^ 0x5a;
    const { env, input } = rig(OLD, patch);
    const result = await applyPatchFile(input);
    expect(result.ok).toBe(false);
    expect(['decode', 'sha256']).toContain((result as { reason: string }).reason);
    expect(env.fs.files.has('/out')).toBe(false);
  });

  it('refuses a frame that is not zstd at all', async () => {
    const patch = (await goodPatch()).slice();
    const index = new DataView(patch.buffer);
    const first = 20 + index.getUint32(16, true) * 16;
    patch.fill(0x42, first, first + 8);
    const { input } = rig(OLD, patch);
    expect(await applyPatchFile(input)).toEqual({ ok: false, reason: 'decode' });
  });

  it('reports a storage failure instead of throwing', async () => {
    const { env, input } = rig(OLD, await goodPatch());
    const broken = { ...env.fs, append: async () => Promise.reject(new Error('disk')) };
    expect(await applyPatchFile({ ...input, fs: broken })).toEqual({ ok: false, reason: 'io' });
  });

  it('refuses when a read comes back shorter than asked', async () => {
    const { env, input } = rig(OLD, await goodPatch());
    const short = { ...env.fs, read: async (path: string, offset: number, length: number) => (await env.fs.read(path, offset, length)).subarray(1) };
    const result = await applyPatchFile({ ...input, fs: short });
    expect(result.ok).toBe(false);
  });

  it('cleans up even when removing the output fails', async () => {
    const { env, input } = rig(OLD, await goodPatch());
    const fs = { ...env.fs, remove: async () => Promise.reject(new Error('busy')) };
    expect(await applyPatchFile({ ...input, fs, sha256: '1'.repeat(64) })).toEqual({ ok: false, reason: 'sha256' });
  });
});

describe('decompressPrefix', () => {
  type Slice = { frame: Uint8Array; reference: Uint8Array; expected: Uint8Array };
  const slicesOf = async (older: Buffer, newer: Buffer): Promise<Slice[]> => {
    const patch = await patchOf(older, newer);
    const view = new DataView(patch.buffer, patch.byteOffset);
    const count = view.getUint32(16, true);
    let frameAt = 20 + count * 16;
    let produced = 0;
    return Array.from({ length: count }, (_, i) => {
      const at = 20 + i * 16;
      const length = view.getUint32(at, true);
      const refStart = view.getUint32(at + 4, true);
      const refLength = view.getUint32(at + 8, true);
      const frameSize = view.getUint32(at + 12, true);
      const slice = { frame: patch.subarray(frameAt, frameAt + frameSize), reference: older.subarray(refStart, refStart + refLength), expected: newer.subarray(produced, produced + length) };
      frameAt += frameSize;
      produced += length;
      return slice;
    });
  };
  const run = (slice: Slice): Uint8Array => decompressPrefix(slice.frame, slice.reference, slice.expected.length);

  it('opens a frame that points back into the bytes before it', async () => {
    const reference = noise(40_000, 'ref');
    const slice = Buffer.concat([reference.subarray(5_000, 25_000), noise(1_000, 'fresh'), reference.subarray(30_000, 39_000)]);
    const [only] = await slicesOf(reference, slice);
    expect(only!.reference.length).toBeGreaterThan(0);
    expect(only!.frame.length).toBeLessThan(slice.length / 5);
    expect(Buffer.from(run(only!)).equals(slice)).toBe(true);
  });

  it('gives the same bytes as stepping through block by block in a buffer that is used again', async () => {
    const reference = noise(30_000, 'r2');
    const slice = Buffer.concat([reference.subarray(1_000, 20_000), noise(2_000, 'x')]);
    const [only] = await slicesOf(reference, slice);
    const work = new Uint8Array(only!.reference.length + slice.length + 5_000).fill(0xee);
    for (let round = 0; round < 2; round++) {
      const view = work.subarray(0, only!.reference.length + slice.length);
      view.set(only!.reference);
      const steps = decompressInPlaceSteps(only!.frame, view, only!.reference.length);
      let taken = 0;
      let result: Uint8Array | undefined;
      for (;;) {
        const next = steps.next();
        if (next.done) {
          result = next.value;
          break;
        }
        taken += 1;
      }
      expect(taken).toBeGreaterThanOrEqual(1);
      expect(Buffer.from(result!).equals(slice)).toBe(true);
      expect(result!.buffer).toBe(work.buffer);
    }
    expect(Buffer.from(run(only!)).equals(slice)).toBe(true);
  });

  it('works for a slice that has no reference bytes at all', async () => {
    const small = noise(10_000, 'tiny');
    const big = Buffer.concat([small, noise(300_000, 'tail')]);
    const slices = await slicesOf(small, big);
    const bare = slices.find((slice) => slice.reference.length === 0)!;
    expect(bare).toBeDefined();
    expect(Buffer.from(run(bare)).equals(bare.expected)).toBe(true);
  });

  it('refuses the wrong output size and data that is not a frame', async () => {
    const reference = noise(30_000, 'r3');
    const slice = Buffer.concat([reference.subarray(1_000, 20_000), noise(2_000, 'y')]);
    const [only] = await slicesOf(reference, slice);
    expect(() => decompressPrefix(only!.frame, only!.reference, slice.length - 1)).toThrow();
    expect(() => decompressPrefix(only!.frame, only!.reference, slice.length + 1)).toThrow();
    expect(() => decompressPrefix(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), only!.reference, 10)).toThrow();
  });
});
