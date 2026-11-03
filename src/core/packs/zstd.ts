import { Decompress } from 'fzstd';
import type { DecodePort } from './ports';

export const createZstdDecode = (): DecodePort => ({
  zstd() {
    let produced: Uint8Array[] = [];
    const stream = new Decompress((chunk) => void produced.push(chunk));
    return {
      push(chunk, last) {
        produced = [];
        stream.push(chunk, last);
        return produced;
      },
    };
  },
});
