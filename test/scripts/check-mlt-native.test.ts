import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipStable, tileIdOf, writePmtiles, type TileSetInfo } from '../../pipeline/build/pmtiles-file';
import { CHECKER, checkArchive, compileArgs, fetchSources, mltArchives, parseCheck, tilePack, type Lock } from '../../scripts/check-mlt-native';

const dir = (): string => mkdtempSync(join(tmpdir(), 'mltcheck-'));
const info: TileSetInfo = { tileCompression: 2, tileType: 6, minZoom: 14, maxZoom: 14, boundsE7: [289000000, 401000000, 291000000, 402000000], centerZoom: 14, centerE7: [290000000, 401500000] };
const hex = (text: string): string => createHash('sha256').update(text).digest('hex');

function archive(path: string): string {
  const a = tileIdOf(14, 9500, 6100);
  writePmtiles(path, info, {}, [
    { tileId: a, data: gzipStable(Buffer.from('birinci')) },
    { tileId: a + 1, data: gzipStable(Buffer.from('ikinci')) },
    { tileId: a + 2, data: gzipStable(Buffer.from('ikinci')) },
  ]);
  return path;
}

describe('parseCheck', () => {
  it('reads the totals and the first failure', () => {
    expect(parseCheck('a', 'ok=12 fail=0\n')).toEqual({ archive: 'a', ok: 12, fail: 0, first: null });
    expect(parseCheck('a', 'FAIL 77 FastPFOR decoding is not enabled\nFAIL 78 x\nok=3 fail=2\n')).toEqual({ archive: 'a', ok: 3, fail: 2, first: 'FAIL 77 FastPFOR decoding is not enabled' });
  });

  it('refuses output it cannot read', () => {
    expect(() => parseCheck('a', 'segmentation fault')).toThrow(/okunamadı/);
  });
});

describe('tilePack', () => {
  it('writes id, length and the unzipped tile for every entry', () => {
    const root = dir();
    const out = join(root, 'a.pack');
    expect(tilePack(archive(join(root, 'a.pmtiles')), out)).toBe(2);
    const bytes = readFileSync(out);
    const first = tileIdOf(14, 9500, 6100);
    expect(Number(bytes.readBigUInt64LE(0))).toBe(first);
    expect(bytes.readUInt32LE(8)).toBe(7);
    expect(bytes.subarray(12, 19).toString()).toBe('birinci');
    expect(Number(bytes.readBigUInt64LE(19))).toBe(first + 1);
    expect(bytes.subarray(31).toString()).toBe('ikinci');
  });
});

describe('checkArchive', () => {
  it('hands the tool a pack, reads its answer and leaves no pack behind', async () => {
    const root = dir();
    const seen: string[][] = [];
    const result = await checkArchive(archive(join(root, 'a.pmtiles')), async (cmd, args) => {
      seen.push([cmd, ...args]);
      expect(existsSync(args[0] as string)).toBe(true);
      return { code: 1, out: 'FAIL 5 Specified physical level technique not yet supported 0\nok=1 fail=1\n' };
    });
    expect(result).toMatchObject({ ok: 1, fail: 1, first: expect.stringContaining('FAIL 5') });
    expect(seen[0]?.[0]).toBe(CHECKER);
    expect(existsSync(seen[0]?.[1] as string)).toBe(false);
  });
});

describe('fetchSources', () => {
  const lock: Lock = { repo: 'org/spec', commit: 'abc123', files: { 'cpp/include/a.hpp': hex('A'), 'cpp/src/b.cpp': hex('B') } };
  const serve = (contents: Record<string, string>, calls: string[]) => async (url: string): Promise<Uint8Array> => {
    calls.push(url);
    return Buffer.from(contents[url.slice(url.indexOf('/abc123/') + 8)] ?? '');
  };

  it('downloads each pinned file once and checks its hash', async () => {
    const root = dir();
    const calls: string[] = [];
    expect(await fetchSources(lock, root, serve({ 'cpp/include/a.hpp': 'A', 'cpp/src/b.cpp': 'B' }, calls))).toBe(2);
    expect(calls).toEqual(['https://raw.githubusercontent.com/org/spec/abc123/cpp/include/a.hpp', 'https://raw.githubusercontent.com/org/spec/abc123/cpp/src/b.cpp']);
    expect(readFileSync(join(root, 'abc123', 'cpp', 'src', 'b.cpp'), 'utf8')).toBe('B');
    expect(await fetchSources(lock, root, serve({}, calls))).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it('fetches again a file that was changed on disk and refuses wrong content', async () => {
    const root = dir();
    await fetchSources(lock, root, serve({ 'cpp/include/a.hpp': 'A', 'cpp/src/b.cpp': 'B' }, []));
    writeFileSync(join(root, 'abc123', 'cpp', 'include', 'a.hpp'), 'bozuk');
    const calls: string[] = [];
    expect(await fetchSources(lock, root, serve({ 'cpp/include/a.hpp': 'A' }, calls))).toBe(1);
    mkdirSync(join(dir(), 'x'));
    await expect(fetchSources(lock, dir(), serve({ 'cpp/include/a.hpp': 'başka', 'cpp/src/b.cpp': 'B' }, []))).rejects.toThrow(/sha256/);
  });
});

describe('compileArgs', () => {
  it('builds the decoder alone with the FastPFOR stubs, the way the phone libraries have it', () => {
    const lock: Lock = { repo: 'org/spec', commit: 'abc123', files: {} };
    const args = compileArgs(lock, '/src', '/bin/check');
    expect(args).toEqual(expect.arrayContaining(['-std=c++20', '-DMLT_WITH_JSON=0', '-I/src/abc123/cpp/include', '-I/src/abc123/cpp/src', '/src/abc123/cpp/src/mlt/decode/int.cpp']));
    expect(args.some((arg) => arg.startsWith('-I') && arg.endsWith('/stubs'))).toBe(true);
    expect(args.slice(-2)).toEqual(['-o', '/bin/check']);
    expect(args.some((arg) => arg.includes('encoder'))).toBe(false);
  });

  it('only needs files the lock pins', () => {
    const lock = JSON.parse(readFileSync(join(__dirname, '..', '..', 'pipeline', 'mlt-native.lock.json'), 'utf8')) as Lock;
    const needed = compileArgs(lock, '/src', '/bin/check').filter((arg) => arg.startsWith('/src/') && arg.endsWith('.cpp')).map((arg) => arg.slice(`/src/${lock.commit}/`.length));
    expect(needed.length).toBeGreaterThan(5);
    for (const path of needed) expect(lock.files[path]).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Object.keys(lock.files).every((path) => path.startsWith('cpp/include/') || path.startsWith('cpp/src/'))).toBe(true);
  });
});

describe('mltArchives', () => {
  it('lists the MLT archives a manifest names', () => {
    const root = dir();
    writeFileSync(join(root, 'manifest-v1.json'), JSON.stringify({ regions: [{ files: [{ path: '16/tiles-1.mlt.pmtiles' }, { path: '16/places-2.pmtiles' }, { path: '16/address-3.sqlite' }] }, { files: [{ path: '34/places-4.mlt.pmtiles' }] }] }));
    expect(mltArchives(root)).toEqual([join(root, '16/tiles-1.mlt.pmtiles'), join(root, '34/places-4.mlt.pmtiles')]);
  });
});
