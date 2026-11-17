import { CryptoDigestAlgorithm, digest } from 'expo-crypto';
import type { FsPort, HashPort } from '../../core/packs/ports';
import { sha256Stream } from '../../core/packs/hash-stream';
import { packError } from '../../core/packs/types';

const WHOLE_FILE_LIMIT = 8 * 1024 * 1024;
const HEX = '0123456789abcdef';

export function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 15);
  return out;
}

export function createExpoHash(fs: FsPort): HashPort {
  return {
    async sha256Blocks(path, blockSize) {
      const size = await fs.size(path);
      if (size === null) throw packError('storage', `missing ${path}`);
      const out: string[] = [];
      for (let offset = 0; offset < size; offset += blockSize) {
        const bytes = await fs.read(path, offset, Math.min(blockSize, size - offset));
        out.push(hexOf(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>))));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      return out;
    },
    async sha256File(path) {
      const size = await fs.size(path);
      if (size === null) throw packError('storage', `missing ${path}`);
      if (size > WHOLE_FILE_LIMIT) return sha256Stream(size, (offset, length) => fs.read(path, offset, length), () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      const bytes = size === 0 ? new Uint8Array(0) : await fs.read(path, 0, size);
      return hexOf(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>)));
    },
  };
}
