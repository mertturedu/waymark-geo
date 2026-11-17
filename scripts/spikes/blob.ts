import type { Yield } from './yielder';

const BLOCK = 1024 * 1024;

function fillBlock(out: Uint8Array, from: number, to: number, state: number): number {
  for (let i = from; i < to; i += 4) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const word = (t ^ (t >>> 14)) >>> 0;
    for (let k = 0; k < 4 && i + k < out.length; k++) out[i + k] = (word >>> (8 * k)) & 0xff;
  }
  return state;
}

export async function seededBytesAsync(seed: number, size: number, yieldNow: Yield): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(size);
  let state = seed >>> 0;
  for (let from = 0; from < size; from += BLOCK) {
    state = fillBlock(out, from, Math.min(from + BLOCK, size), state);
    await yieldNow();
  }
  return out;
}

export function seededBytes(seed: number, size: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size);
  let state = seed >>> 0;
  for (let i = 0; i < size; i += 4) {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const word = (t ^ (t >>> 14)) >>> 0;
    for (let k = 0; k < 4 && i + k < size; k++) out[i + k] = (word >>> (8 * k)) & 0xff;
  }
  return out;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
