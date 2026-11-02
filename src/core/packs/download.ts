import type { ClockPort, FsPort, HashPort, NetPort } from './ports';
import type { FileBlocks } from '../region/manifest';
import { isPackError, packError } from './types';

export type DownloadFileInput = {
  fs: FsPort;
  net: NetPort;
  hash: HashPort;
  clock: ClockPort;
  url: string;
  partPath: string;
  finalPath: string;
  size: number;
  sha256: string;
  blocks?: FileBlocks;
  maxRetries?: number;
  onProgress?: (done: number, total: number) => void;
  onVerify?: () => void;
  signal?: AbortSignal;
};

const SPACE_MARGIN = 1.2;
const MAX_RESTARTS = 3;

type Step = 'done' | 'retry' | 'restart';

async function verifyFile(hash: HashPort, path: string, input: DownloadFileInput): Promise<boolean> {
  const { blocks } = input;
  if (blocks && hash.sha256Blocks) {
    const found = await hash.sha256Blocks(path, blocks.size);
    return found.length === blocks.sha256.length && found.every((h, i) => h === blocks.sha256[i]);
  }
  return (await hash.sha256File(path)) === input.sha256;
}

export async function downloadFile(input: DownloadFileInput): Promise<{ bytes: number; retries: number }> {
  const { fs, net, hash, clock, url, partPath, finalPath, size, signal } = input;
  const maxRetries = input.maxRetries ?? 5;
  if ((await fs.size(finalPath)) === size) return { bytes: size, retries: 0 };

  let have = (await fs.size(partPath)) ?? 0;
  if (have > size) {
    await fs.truncate(partPath);
    have = 0;
  }
  if ((await fs.freeBytes()) < Math.ceil((size - have) * SPACE_MARGIN)) throw packError('no-space');

  const stopIfAborted = (): void => {
    if (signal?.aborted) throw packError('cancelled');
  };

  const restart = async (): Promise<void> => {
    await fs.truncate(partPath);
    have = 0;
  };

  const fetchMore = async (): Promise<Step> => {
    let response;
    try {
      response = await net.get(url, { ...(have > 0 ? { rangeStart: have } : {}), ...(signal ? { signal } : {}) });
    } catch {
      stopIfAborted();
      return 'retry';
    }
    const { status } = response;
    if (status === 404 || status === 403) {
      await fs.remove(partPath);
      throw packError('http-404', `HTTP ${status}`);
    }
    if (status === 416) {
      await restart();
      return 'restart';
    }
    if (status >= 500 || status === 408 || status === 429) return 'retry';
    if (status !== 200 && status !== 206) {
      await fs.remove(partPath);
      throw packError('http', `HTTP ${status}`);
    }
    if (status === 200 && have > 0) await restart();
    try {
      for await (const chunk of response.body) {
        stopIfAborted();
        const piece = chunk.length > size - have ? chunk.slice(0, size - have) : chunk;
        if (piece.length > 0) {
          await fs.append(partPath, piece);
          have += piece.length;
          input.onProgress?.(have, size);
        }
        if (have >= size) break;
      }
    } catch (error) {
      if (isPackError(error)) throw error;
      return 'retry';
    }
    return 'done';
  };

  let retries = 0;
  let streak = 0;
  let restarts = 0;
  let corrupt = 0;
  for (;;) {
    stopIfAborted();
    if (have < size) {
      const before = have;
      const step = await fetchMore();
      if (have > before) streak = 0;
      if (step === 'restart') {
        if (++restarts > MAX_RESTARTS) throw packError('http', 'range not accepted');
        continue;
      }
      if (step === 'retry' || have < size) {
        retries += 1;
        if (++streak > maxRetries) throw packError('network');
        await clock.sleep(Math.min(500 * 2 ** (streak - 1), 8000));
        continue;
      }
    }
    input.onVerify?.();
    const matches = await verifyFile(hash, partPath, input).catch((error: unknown) => {
      if (isPackError(error) && error.code === 'storage') return false;
      throw error;
    });
    if (matches) break;
    await fs.remove(partPath);
    have = 0;
    if (++corrupt > 1) throw packError('checksum');
  }

  await fs.move(partPath, finalPath);
  if ((await fs.size(finalPath)) !== size) throw packError('storage', 'file incomplete after move');
  return { bytes: size, retries };
}
