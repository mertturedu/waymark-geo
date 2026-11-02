import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileStore } from '../../src/node/learn-store';

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'learn-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('fileStore', () => {
  it('is empty when the file does not exist yet', async () => {
    expect(await fileStore(join(dir, 'learn.json')).readAll()).toEqual([]);
  });

  it('returns the same rows after it is opened again', async () => {
    const path = join(dir, 'learn.json');
    const first = fileStore(path);
    await first.write('b', '{"n":2}');
    await first.write('a', '{"n":1}');
    await first.write('b', '{"n":3}');
    await first.remove('zzz');
    expect(await fileStore(path).readAll()).toEqual([{ key: 'a', value: '{"n":1}' }, { key: 'b', value: '{"n":3}' }]);
    await first.remove('a');
    expect(await fileStore(path).readAll()).toEqual([{ key: 'b', value: '{"n":3}' }]);
  });

  it('keeps every write when many arrive at once', async () => {
    const path = join(dir, 'learn.json');
    const store = fileStore(path);
    await Promise.all(Array.from({ length: 40 }, (_, i) => store.write(`k${String(i).padStart(2, '0')}`, String(i))));
    expect((await fileStore(path).readAll()).map((r) => r.value)).toEqual(Array.from({ length: 40 }, (_, i) => String(i)));
  });

  it('leaves no temporary file behind', async () => {
    const store = fileStore(join(dir, 'learn.json'));
    await store.write('a', '1');
    expect(await readdir(dir)).toEqual(['learn.json']);
  });

  it('does not throw on a damaged file and keeps a copy of it', async () => {
    const path = join(dir, 'learn.json');
    await writeFile(path, '{"rows": [broken');
    const store = fileStore(path);
    expect(await store.readAll()).toEqual([]);
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('{"rows": [broken');
    await store.write('a', '1');
    expect(await fileStore(path).readAll()).toEqual([{ key: 'a', value: '1' }]);
    expect(await readFile(`${path}.bak`, 'utf8')).toBe('{"rows": [broken');
  });

  it('treats a file of the wrong shape as damaged too', async () => {
    const path = join(dir, 'learn.json');
    await writeFile(path, JSON.stringify({ rows: { a: 5 } }));
    expect(await fileStore(path).readAll()).toEqual([]);
    expect(await readFile(`${path}.bak`, 'utf8')).toContain('"a":5');
  });
});
