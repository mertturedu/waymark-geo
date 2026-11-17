import { createHash, randomBytes } from 'node:crypto';
import { sha256Stream } from '../../src/core/packs/hash-stream';

const bytes = new Uint8Array(randomBytes(5 * 1024 * 1024 + 123));
const expected = createHash('sha256').update(bytes).digest('hex');
const reader = (offset: number, length: number) => Promise.resolve(bytes.subarray(offset, offset + length));

describe('streamed sha-256', () => {
  it('matches the whole-file digest for a size that is not a multiple of the chunk', async () => {
    expect(await sha256Stream(bytes.length, reader, async () => undefined)).toBe(expected);
  });

  it('matches for small chunks and pauses between them', async () => {
    let pauses = 0;
    const digest = await sha256Stream(bytes.length, reader, async () => void (pauses += 1), 1024 * 1024);
    expect(digest).toBe(expected);
    expect(pauses).toBe(6);
  });

  it('digests an empty file', async () => {
    expect(await sha256Stream(0, reader, async () => undefined)).toBe(createHash('sha256').update('').digest('hex'));
  });

  it('never asks for more than the chunk size', async () => {
    const asked: number[] = [];
    await sha256Stream(bytes.length, async (offset, length) => (asked.push(length), reader(offset, length)), async () => undefined, 1024 * 1024);
    expect(Math.max(...asked)).toBe(1024 * 1024);
  });
});
