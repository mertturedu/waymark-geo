import { decompressInPlaceSteps } from './fzstd';
import { patchIndexBytes, PATCH_HEADER_BYTES, readPatchIndex } from './patch';
import type { FileBlocks } from '../region/manifest';
import type { FsPort, HashPort } from './ports';

export type PatchFailure = 'patch' | 'old' | 'decode' | 'sha256' | 'io' | 'cancelled';
export type PatchResult = { ok: true; bytes: number; slices: number } | { ok: false; reason: PatchFailure };

export type PatchInput = {
  fs: Pick<FsPort, 'size' | 'read' | 'append' | 'truncate' | 'remove'>;
  hash: Pick<HashPort, 'sha256File' | 'sha256Blocks'>;
  oldPath: string;
  patchPath: string;
  outPath: string;
  sha256: string;
  blocks?: FileBlocks;
  pause: () => Promise<void>;
  now?: () => number;
  budgetMs?: number;
  chunkBytes?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
};

const BUDGET_MS = 8;
const READ_CHUNK = 1024 * 1024;

async function readInto(fs: PatchInput['fs'], path: string, offset: number, length: number, into: Uint8Array, at: number, chunkBytes: number): Promise<boolean> {
  for (let done = 0; done < length; done += chunkBytes) {
    const want = Math.min(chunkBytes, length - done);
    const chunk = await fs.read(path, offset + done, want);
    if (chunk.length !== want) return false;
    into.set(chunk, at + done);
  }
  return true;
}

async function matches(input: PatchInput): Promise<boolean> {
  const { blocks, hash } = input;
  if (blocks && hash.sha256Blocks) {
    const found = await hash.sha256Blocks(input.outPath, blocks.size);
    return found.length === blocks.sha256.length && found.every((h, i) => h === blocks.sha256[i]);
  }
  return (await hash.sha256File(input.outPath)) === input.sha256;
}

export async function applyPatchFile(input: PatchInput): Promise<PatchResult> {
  const { fs } = input;
  const now = input.now ?? Date.now;
  const budget = input.budgetMs ?? BUDGET_MS;
  const chunk = input.chunkBytes ?? READ_CHUNK;
  const fail = async (reason: PatchFailure): Promise<PatchResult> => {
    await fs.remove(input.outPath).catch(() => undefined);
    return { ok: false, reason };
  };
  try {
    const patchSize = await fs.size(input.patchPath);
    if (patchSize === null) return await fail('patch');
    const head = patchIndexBytes(await fs.read(input.patchPath, 0, PATCH_HEADER_BYTES));
    if (head === null || head > patchSize) return await fail('patch');
    const index = readPatchIndex(await fs.read(input.patchPath, 0, head), patchSize);
    if (index === null) return await fail('patch');
    if (index.oldSize !== (await fs.size(input.oldPath))) return await fail('old');
    await fs.truncate(input.outPath);
    let written = 0;
    let last = now();
    const work = new Uint8Array(Math.max(...index.slices.map((slice) => slice.refLength + slice.length)));
    const frames = new Uint8Array(Math.max(...index.slices.map((slice) => slice.frameSize)));
    for (const slice of index.slices) {
      if (input.signal?.aborted) return await fail('cancelled');
      if (!(await readInto(fs, input.oldPath, slice.refStart, slice.refLength, work, 0, chunk))) return await fail('old');
      if (!(await readInto(fs, input.patchPath, slice.frameOffset, slice.frameSize, frames, 0, chunk))) return await fail('patch');
      let piece: Uint8Array | undefined;
      try {
        const steps = decompressInPlaceSteps(frames.subarray(0, slice.frameSize), work.subarray(0, slice.refLength + slice.length), slice.refLength);
        for (;;) {
          const next = steps.next();
          if (next.done) {
            piece = next.value;
            break;
          }
          if (now() - last >= budget) {
            await input.pause();
            last = now();
          }
        }
      } catch {
        return await fail('decode');
      }
      await fs.append(input.outPath, piece);
      written += piece.length;
      input.onProgress?.(written, index.newSize);
      await input.pause();
      last = now();
    }
    if (!(await matches(input))) return await fail('sha256');
    return { ok: true, bytes: written, slices: index.slices.length };
  } catch {
    return await fail('io');
  }
}
