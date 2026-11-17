import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { Yield } from './yielder';

export type DownloadErrorCode = 'HEAD_FAILED' | 'HTTP_ERROR' | 'INSUFFICIENT_SPACE' | 'DOWNLOAD_FAILED' | 'CHECKSUM_MISMATCH';

export class DownloadError extends Error {
  constructor(
    readonly code: DownloadErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export type Store = {
  size(): Promise<number>;
  append(chunk: Uint8Array): Promise<void>;
  truncate(): Promise<void>;
  read(offset: number, length: number): Promise<Uint8Array>;
};

export type DownloadPlan = { start: number; total: number; done: boolean };

export type DownloadOptions = {
  url: string;
  store: Store;
  sha256: string;
  fetchImpl: typeof fetch;
  maxRetries: number;
  freeBytes?: () => Promise<number>;
  onProgress?: (done: number, total: number) => void;
  yieldNow?: Yield;
  hashStore?: (store: Store, total: number) => Promise<string>;
};

const HASH_CHUNK = 1024 * 1024;
const SPACE_MARGIN = 1.2;

export function planResume(existingBytes: number, totalBytes: number): DownloadPlan {
  if (existingBytes > totalBytes) return { start: 0, total: totalBytes, done: false };
  return { start: existingBytes, total: totalBytes, done: existingBytes === totalBytes };
}

async function remoteSize(options: DownloadOptions): Promise<number> {
  let response: Response;
  try {
    response = await options.fetchImpl(options.url, { method: 'HEAD' });
  } catch {
    throw new DownloadError('HEAD_FAILED', 'server unreachable');
  }
  const length = Number(response.headers.get('content-length'));
  if (!response.ok || !Number.isInteger(length) || length <= 0) throw new DownloadError('HEAD_FAILED', `HEAD ${response.status}`);
  return length;
}

async function transfer(options: DownloadOptions, start: number, total: number): Promise<void> {
  const { store } = options;
  const response = await options.fetchImpl(options.url, { headers: { Range: `bytes=${start}-` } });
  if (!response.ok) throw new DownloadError('HTTP_ERROR', `GET ${response.status}`);
  let done = start;
  if (start > 0 && response.status === 200) {
    await store.truncate();
    done = 0;
  }
  const reader = response.body?.getReader();
  if (!reader) {
    const chunk = new Uint8Array(await response.arrayBuffer());
    await store.append(chunk);
    options.onProgress?.(done + chunk.length, total);
    return;
  }
  try {
    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) return;
      await store.append(value);
      done += value.length;
      options.onProgress?.(done, total);
      await options.yieldNow?.();
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
}

export async function storeSha256(store: Store, total: number, yieldNow?: Yield): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < total; offset += HASH_CHUNK) {
    hash.update(await store.read(offset, Math.min(HASH_CHUNK, total - offset)));
    await yieldNow?.();
  }
  return bytesToHex(hash.digest());
}

export async function download(options: DownloadOptions): Promise<{ bytes: number; retries: number }> {
  const { store } = options;
  const total = await remoteSize(options);
  if ((await store.size()) > total) await store.truncate();
  if (options.freeBytes) {
    const missing = total - (await store.size());
    if ((await options.freeBytes()) < Math.ceil(missing * SPACE_MARGIN)) throw new DownloadError('INSUFFICIENT_SPACE');
  }

  let retries = 0;
  let restarts = 0;
  let lastError = '';
  for (;;) {
    const plan = planResume(await store.size(), total);
    if (!plan.done) {
      try {
        await transfer(options, plan.start, total);
      } catch (error) {
        if (error instanceof DownloadError) {
          await store.truncate();
          throw error;
        }
        lastError = error instanceof Error ? error.message : String(error);
      }
      if ((await store.size()) < total) {
        retries++;
        if (retries > options.maxRetries) throw new DownloadError('DOWNLOAD_FAILED', `${retries} attempts${lastError ? `, last error: ${lastError}` : ''}`);
        continue;
      }
    }
    if ((await (options.hashStore ?? ((s, t) => storeSha256(s, t, options.yieldNow)))(store, total)) === options.sha256) return { bytes: total, retries };
    await store.truncate();
    if (restarts++ >= 1) throw new DownloadError('CHECKSUM_MISMATCH');
  }
}
