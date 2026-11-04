import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { firstTileId, gzipStable, HEADER_LENGTH, openPmtiles, parseDirectory, rewritePmtiles, serializeDirectory, tileIdOf, writePmtiles, zoomOfTileId, zxyOf, type TileSetInfo } from '../../pipeline/build/pmtiles-file';
import { pmtilesBin } from '../../pipeline/build/tiles';

const info: TileSetInfo = { tileCompression: 2, tileType: 1, minZoom: 0, maxZoom: 14, boundsE7: [280000000, 400000000, 300000000, 420000000], centerZoom: 7, centerE7: [290000000, 410000000] };
const dir = (): string => mkdtempSync(join(tmpdir(), 'pmtiles-'));
const blob = (text: string): Uint8Array => gzipStable(Buffer.from(text));

function tilesOf(path: string): Map<number, string> {
  const archive = openPmtiles(path);
  const out = new Map<number, string>();
  for (const entry of archive.entries) for (let i = 0; i < entry.runLength; i++) out.set(entry.tileId + i, gunzipSync(archive.read(entry)).toString());
  archive.close();
  return out;
}

describe('tile ids', () => {
  it('follow the PMTiles Hilbert order', () => {
    expect([tileIdOf(0, 0, 0), tileIdOf(1, 0, 0), tileIdOf(1, 0, 1), tileIdOf(1, 1, 1), tileIdOf(1, 1, 0), tileIdOf(2, 0, 0)]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tileIdOf(12, 3423, 1763)).toBe(19078479);
  });

  it('turn back into z/x/y and zoom', () => {
    for (const [z, x, y] of [[0, 0, 0], [5, 17, 12], [12, 2295, 1530], [15, 18960, 12350]] as [number, number, number][]) {
      const id = tileIdOf(z, x, y);
      expect(zxyOf(id)).toEqual([z, x, y]);
      expect(zoomOfTileId(id)).toBe(z);
    }
    expect(firstTileId(3)).toBe(21);
    expect(zoomOfTileId(firstTileId(9) - 1)).toBe(8);
  });
});

describe('directories', () => {
  it('write offsets that follow each other as zero and read them back', () => {
    const entries = [
      { tileId: 0, offset: 0, length: 10, runLength: 1 },
      { tileId: 1, offset: 10, length: 5, runLength: 3 },
      { tileId: 9, offset: 0, length: 10, runLength: 1 },
    ];
    const raw = gunzipSync(serializeDirectory(entries));
    expect([...raw]).toEqual([3, 0, 1, 8, 1, 3, 1, 10, 5, 10, 1, 0, 1]);
    expect(parseDirectory(raw)).toEqual(entries);
  });
});

describe('writePmtiles', () => {
  it('stores each content once and runs repeated neighbours together', () => {
    const path = join(dir(), 'a.pmtiles');
    const result = writePmtiles(path, info, { name: 'deneme' }, [
      { tileId: 0, data: blob('kök') },
      { tileId: 1, data: blob('deniz') },
      { tileId: 2, data: blob('deniz') },
      { tileId: 3, data: blob('deniz') },
      { tileId: 5, data: blob('kara') },
      { tileId: 6, data: blob('deniz') },
    ]);
    expect(result).toMatchObject({ addressed: 6, entries: 4, contents: 3, bytes: statSync(path).size });
    const archive = openPmtiles(path);
    expect(archive.metadata).toEqual({ name: 'deneme' });
    expect(archive.header).toMatchObject({ ...info, clustered: true, internalCompression: 2, addressed: 6, entries: 4, contents: 3, rootOffset: HEADER_LENGTH });
    expect(archive.entries.map((e) => [e.tileId, e.runLength])).toEqual([[0, 1], [1, 3], [5, 1], [6, 1]]);
    archive.close();
    expect([...tilesOf(path)]).toEqual([[0, 'kök'], [1, 'deniz'], [2, 'deniz'], [3, 'deniz'], [5, 'kara'], [6, 'deniz']]);
  });

  it('moves entries into leaf directories when the root would be too big', () => {
    const path = join(dir(), 'b.pmtiles');
    const tiles = Array.from({ length: 30000 }, (_, i) => ({ tileId: i * 2, data: blob(`karo ${i}`) }));
    writePmtiles(path, info, {}, tiles);
    const archive = openPmtiles(path);
    expect(archive.header.leafLength).toBeGreaterThan(0);
    expect(archive.header.rootLength).toBeLessThanOrEqual(16384 - HEADER_LENGTH);
    expect(archive.entries).toHaveLength(30000);
    expect(gunzipSync(archive.read(archive.entries[29999]!)).toString()).toBe('karo 29999');
    archive.close();
  });

  it('refuses tiles out of order', () => {
    expect(() => writePmtiles(join(dir(), 'c.pmtiles'), info, {}, [{ tileId: 4, data: blob('a') }, { tileId: 4, data: blob('b') }])).toThrow(/artan/);
  });

  it('writes the same bytes for the same input', () => {
    const a = join(dir(), 'a.pmtiles');
    const b = join(dir(), 'b.pmtiles');
    const tiles = [{ tileId: 0, data: blob('x') }, { tileId: 3, data: blob('y') }];
    writePmtiles(a, info, { k: 1 }, tiles);
    writePmtiles(b, info, { k: 1 }, tiles);
    expect(readFileSync(a).equals(readFileSync(b))).toBe(true);
  });

  (existsSync(pmtilesBin) ? it : it.skip)('passes pmtiles verify', () => {
    const path = join(dir(), 'v.pmtiles');
    writePmtiles(path, { ...info, minZoom: 8, maxZoom: 8, centerZoom: 8 }, { name: 'v' }, Array.from({ length: 20000 }, (_, i) => ({ tileId: firstTileId(8) + i, data: blob(String(i % 7)) })));
    const run = spawnSync(pmtilesBin, ['verify', path], { encoding: 'utf8' });
    expect(run.stderr).not.toMatch(/invalid/);
    expect(run.status).toBe(0);
  });
});

describe('rewritePmtiles', () => {
  it('keeps every tile, the header facts and the metadata', () => {
    const root = dir();
    const source = join(root, 'a.pmtiles');
    writePmtiles(source, info, { name: 'kaynak', vector_layers: [{ id: 'water' }] }, [
      { tileId: 0, data: blob('kök') },
      { tileId: 1, data: blob('deniz') },
      { tileId: 2, data: blob('deniz') },
      { tileId: 6, data: blob('kara') },
    ]);
    const target = join(root, 'b.pmtiles');
    expect(rewritePmtiles(source, target)).toMatchObject({ addressed: 4, entries: 3, contents: 3 });
    expect([...tilesOf(target)]).toEqual([...tilesOf(source)]);
    const a = openPmtiles(source);
    const b = openPmtiles(target);
    expect(b.header).toMatchObject({ ...info, clustered: true });
    expect(b.metadata).toEqual(a.metadata);
    a.close();
    b.close();
  });

  (existsSync(pmtilesBin) ? it : it.skip)('gives an archive that passes pmtiles verify', () => {
    const root = dir();
    const source = join(root, 'a.pmtiles');
    writePmtiles(source, { ...info, minZoom: 8, maxZoom: 8, centerZoom: 8 }, {}, [{ tileId: firstTileId(8), data: blob('x') }]);
    const target = join(root, 'b.pmtiles');
    rewritePmtiles(source, target);
    const run = spawnSync(pmtilesBin, ['verify', target], { encoding: 'utf8' });
    expect(run.stderr).not.toMatch(/invalid|Failed/);
    expect(run.status).toBe(0);
  });
});

describe('openPmtiles', () => {
  it('rejects files that are not PMTiles v3', () => {
    const path = join(dir(), 'x.pmtiles');
    writePmtiles(path, info, {}, [{ tileId: 0, data: blob('a') }]);
    const bytes = readFileSync(path);
    bytes[7] = 2;
    const broken = join(dir(), 'y.pmtiles');
    writeFileSync(broken, bytes);
    expect(() => openPmtiles(broken)).toThrow(/PMTiles v3/);
  });
});

describe('gzipStable', () => {
  it('writes an unknown operating system into the gzip header', () => {
    expect(gzipStable(Buffer.from('a'))[9]).toBe(255);
  });
});
