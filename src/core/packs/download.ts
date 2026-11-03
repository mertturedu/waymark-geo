import type { ClockPort, DecodePort, FsPort, HashPort, NetPort } from './ports';
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
  encoded?: { url: string; partPath: string; finalPath: string; size: number; sha256: string };
  decode?: DecodePort;
  maxRetries?: number;
  onProgress?: (done: number, total: number) => void;
  onVerify?: () => void;
  signal?: AbortSignal;
};

const SPACE_MARGIN = 1.2;
const DECODE_CHUNK = 256 * 1024;
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

async function decodeInto(input: DownloadFileInput, encodedPath: string): Promise<void> {
  const { fs, hash, partPath, size } = input;
  if ((await fs.freeBytes()) < Math.ceil(size * SPACE_MARGIN)) throw packError('no-space');
  await fs.truncate(partPath);
  const stream = (input.decode as DecodePort).zstd();
  const length = (await fs.size(encodedPath)) ?? 0;
  try {
    for (let offset = 0; offset < length; offset += DECODE_CHUNK) {
      if (input.signal?.aborted) throw packError('cancelled');
      const chunk = await fs.read(encodedPath, offset, Math.min(DECODE_CHUNK, length - offset));
      for (const piece of stream.push(chunk, offset + DECODE_CHUNK >= length)) if (piece.length > 0) await fs.append(partPath, piece);
    }
  } catch (error) {
    if (isPackError(error)) throw error;
    await fs.remove(partPath);
    await fs.remove(encodedPath);
    throw packError('checksum', 'zstd');
  }
  if ((await fs.size(partPath)) !== size || !(await verifyFile(hash, partPath, input))) {
    await fs.remove(partPath);
    await fs.remove(encodedPath);
    throw packError('checksum');
  }
}

async function downloadEncoded(input: DownloadFileInput): Promise<{ bytes: number; retries: number }> {
  const { fs, finalPath, size } = input;
  const encoded = input.encoded as NonNullable<DownloadFileInput['encoded']>;
  const fetched = await downloadFile({
    ...input,
    url: encoded.url,
    partPath: encoded.partPath,
    finalPath: encoded.finalPath,
    size: encoded.size,
    sha256: encoded.sha256,
    onProgress: (done) => input.onProgress?.(Math.min(size, Math.floor((done * size) / encoded.size)), size),
    encoded: undefined,
    decode: undefined,
    blocks: undefined,
  });
  input.onVerify?.();
  await decodeInto(input, encoded.finalPath);
  await fs.move(input.partPath, finalPath);
  await fs.remove(encoded.finalPath);
  if ((await fs.size(finalPath)) !== size) throw packError('storage', 'file incomplete after move');
  input.onProgress?.(size, size);
  return { bytes: size, retries: fetched.retries };
}

export async function downloadFile(input: DownloadFileInput): Promise<{ bytes: number; retries: number }> {
  const { fs, net, hash, clock, url, partPath, finalPath, size, signal } = input;
  const maxRetries = input.maxRetries ?? 5;
  if ((await fs.size(finalPath)) === size) return { bytes: size, retries: 0 };
  if (input.encoded && input.decode) return downloadEncoded(input);

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
