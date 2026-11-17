import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore } from '../../src/node/learn-store';

const dir = (): string => mkdtempSync(join(tmpdir(), 'geo-fs-'));

describe('fileStore when a save fails', () => {
  it('does not keep the row in memory for the next write to carry to disk', async () => {
    const d = dir();
    const path = join(d, 'sub', 'learn.json');
    const store = fileStore(path);
    await store.write('a', '1');
    chmodSync(join(d, 'sub'), 0o500);
    try {
      if (process.getuid && process.getuid() === 0) return;
      await expect(store.write('c', '3')).rejects.toThrow();
    } finally {
      chmodSync(join(d, 'sub'), 0o700);
    }
    await store.write('e', '5');
    expect((await fileStore(path).readAll()).map((r) => r.key)).toEqual(['a', 'e']);
    expect((await store.readAll()).map((r) => r.key)).toEqual(['a', 'e']);
  });

  it('does the same for a failed removal', async () => {
    const d = dir();
    const path = join(d, 'sub', 'learn.json');
    const store = fileStore(path);
    await store.write('a', '1');
    chmodSync(join(d, 'sub'), 0o500);
    try {
      if (process.getuid && process.getuid() === 0) return;
      await expect(store.remove('a')).rejects.toThrow();
    } finally {
      chmodSync(join(d, 'sub'), 0o700);
    }
    expect((await store.readAll()).map((r) => r.key)).toEqual(['a']);
  });
});

describe('fileStore backups and twins', () => {
  it('keeps the first backup when the file breaks a second time', async () => {
    const path = join(dir(), 'learn.json');
    writeFileSync(path, 'BROKEN1');
    await fileStore(path).readAll();
    writeFileSync(path, 'BROKEN2');
    await fileStore(path).readAll();
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe('BROKEN1');
    expect(readFileSync(`${path}.bak.1`, 'utf8')).toBe('BROKEN2');
  });

  it('survives two instances writing to one path', async () => {
    const path = join(dir(), 'learn.json');
    const a = fileStore(path);
    const b = fileStore(path);
    await Promise.all([a.write('x', '1'), b.write('y', '2')]);
    expect(existsSync(path)).toBe(true);
    expect(readdirSync(join(path, '..')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
