import * as Crypto from 'expo-crypto';
import { bytesToHex } from '@noble/hashes/utils';
import type { Store } from '../../../../scripts/spikes/resume-download';

export async function nativeStoreSha256(store: Store, total: number): Promise<string> {
  const bytes = await store.read(0, total);
  return bytesToHex(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>)));
}
