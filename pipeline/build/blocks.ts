import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { FileBlocks } from '../../src/core/region/manifest';

export const BLOCK_SIZE = 4 * 1024 * 1024;
const BLOCK_MIN_FILE = 8 * 1024 * 1024;

export function blocksOf(path: string): FileBlocks | undefined {
  const size = statSync(path).size;
  if (size <= BLOCK_MIN_FILE) return undefined;
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(BLOCK_SIZE);
    const sha256: string[] = [];
    for (let offset = 0; offset < size; offset += BLOCK_SIZE) {
      const read = readSync(fd, buffer, 0, Math.min(BLOCK_SIZE, size - offset), offset);
      sha256.push(createHash('sha256').update(buffer.subarray(0, read)).digest('hex'));
    }
    return { size: BLOCK_SIZE, sha256 };
  } finally {
    closeSync(fd);
  }
}
