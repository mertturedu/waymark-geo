import * as Crypto from 'expo-crypto';
import { bytesToHex } from '@noble/hashes/utils';
import type { FsPort, HashPort } from '../../../../src/core/packs/ports';
import { packError } from '../../../../src/core/packs/types';
import type { Store } from '../../../../scripts/spikes/resume-download';

const nativeSha256 = async (bytes: Uint8Array): Promise<string> => bytesToHex(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>)));

export const nativeStoreSha256 = async (store: Store, total: number): Promise<string> => nativeSha256(await store.read(0, total));

export const nativeFsHash = (fs: FsPort): HashPort => ({
  async sha256File(path) {
    const size = await fs.size(path);
    if (size === null) throw packError('storage', `missing ${path}`);
    return nativeSha256(size === 0 ? new Uint8Array(0) : await fs.read(path, 0, size));
  },
});
