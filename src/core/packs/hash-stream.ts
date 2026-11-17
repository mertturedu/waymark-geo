import { sha256 } from '@noble/hashes/sha2';

export const STREAM_CHUNK_BYTES = 2 * 1024 * 1024;

const HEX = '0123456789abcdef';

function hexOf(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 15);
  return out;
}

export async function sha256Stream(size: number, read: (offset: number, length: number) => Promise<Uint8Array>, pause: () => Promise<void>, chunk = STREAM_CHUNK_BYTES): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < size; offset += chunk) {
    hash.update(await read(offset, Math.min(chunk, size - offset)));
    await pause();
  }
  return hexOf(hash.digest());
}
