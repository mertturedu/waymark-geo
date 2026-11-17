import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBytes, writeBytes, type ByteHandle } from '../../src/native/platform/compat';

const data = Uint8Array.from([1, 2, 3, 4]);

function handle57(): ByteHandle & { written: Uint8Array[] } {
  const written: Uint8Array[] = [];
  return { offset: 0, written, readBytes: (length) => data.slice(0, length), writeBytes: (bytes) => void written.push(bytes) };
}

function handle58(withSync: boolean): ByteHandle & { written: Uint8Array[]; calls: string[] } {
  const written: Uint8Array[] = [];
  const calls: string[] = [];
  return {
    offset: 0,
    written,
    calls,
    readBytes: async (length) => {
      calls.push('async');
      return data.slice(0, length);
    },
    writeBytes: async (bytes) => {
      calls.push('async');
      await Promise.resolve();
      written.push(bytes);
    },
    ...(withSync
      ? {
          readBytesSync: (length: number) => {
            calls.push('sync');
            return data.slice(0, length);
          },
          writeBytesSync: (bytes: Uint8Array) => {
            calls.push('sync');
            written.push(bytes);
          },
        }
      : {}),
  };
}

describe('file handle compatibility', () => {
  it('reads and writes with the synchronous handle of Expo 57', async () => {
    const handle = handle57();
    expect(await readBytes(handle, 3)).toEqual(Uint8Array.from([1, 2, 3]));
    await writeBytes(handle, data);
    expect(handle.written).toEqual([data]);
  });

  it('prefers the synchronous calls when Expo 58 provides them', async () => {
    const handle = handle58(true);
    expect(await readBytes(handle, 2)).toEqual(Uint8Array.from([1, 2]));
    await writeBytes(handle, data);
    expect(handle.calls).toEqual(['sync', 'sync']);
    expect(handle.written).toEqual([data]);
  });

  it('waits for the asynchronous calls when only those exist', async () => {
    const handle = handle58(false);
    expect(await readBytes(handle, 4)).toEqual(data);
    await writeBytes(handle, data);
    expect(handle.calls).toEqual(['async', 'async']);
    expect(handle.written).toEqual([data]);
  });

  it('surfaces a rejected write instead of dropping it', async () => {
    const handle = handle58(false);
    handle.writeBytes = async () => {
      throw new Error('disk full');
    };
    await expect(writeBytes(handle, data)).rejects.toThrow('disk full');
  });
});

describe('platform file layer', () => {
  it('reaches the file handle only through the compatibility helpers', () => {
    const text = readFileSync(join(__dirname, '../../src/native/platform/fs.ts'), 'utf8');
    expect(/\.(readBytes|writeBytes)(Sync)?\(/.test(text)).toBe(false);
  });
});
