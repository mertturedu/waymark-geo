import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeLayer, decodeTile, encodeLayer, encodeTile, type MvtLayer } from '../../pipeline/build/mvt';
import { gzipStable, openPmtiles, tileIdOf, writePmtiles, type TileSetInfo } from '../../pipeline/build/pmtiles-file';
import { encodeAll, encodeMlt, isMlt, mltBin, nameMatchesFormat, stripFeatureIds, tileFormat, tilesMinSdk } from '../../pipeline/build/tile-encode';
import { pmtilesBin, type Runner } from '../../pipeline/build/tiles';

const dir = (): string => mkdtempSync(join(tmpdir(), 'mlt-'));
const info: TileSetInfo = { tileCompression: 2, tileType: 1, minZoom: 14, maxZoom: 14, boundsE7: [289000000, 401000000, 291000000, 402000000], centerZoom: 14, centerE7: [290000000, 401500000] };
const utf8 = new TextEncoder();
const archive = (path: string, tileType = 1): string => {
  const layer = { name: 'water', version: 2, extent: 4096, keys: ['kind'], values: [Uint8Array.from([10, 4, ...utf8.encode('lake')])], features: [{ id: Uint8Array.from([1]), tags: [0, 0], type: 3, geometry: Uint8Array.from([9, 0, 0, 26, 20, 0, 0, 20, 19, 0, 15]), order: [1, 2, 3, 4] }], order: [15, 1, 2, 3, 4, 5] };
  writePmtiles(path, { ...info, tileType }, { name: 'deneme' }, [{ tileId: tileIdOf(14, 9500, 6100), data: gzipStable(encodeTile([encodeLayer(layer)])) }]);
  return path;
};
const fakeMlt = (code = 0, tileType = 6): Runner => async (_cmd, args) => {
  if (code === 0) archive(args[args.length - 1] as string, tileType);
  return { code, out: code === 0 ? '' : 'convert failed' };
};

describe('tileFormat', () => {
  it('is vector tiles unless MLT is asked for', () => {
    expect([tileFormat(undefined), tileFormat(''), tileFormat('mvt'), tileFormat('mlt')]).toEqual(['mvt', 'mvt', 'mvt', 'mlt']);
    expect(() => tileFormat('pbf')).toThrow(/GEO_TILE_FORMAT/);
  });
});

describe('isMlt and tilesMinSdk', () => {
  it('read the tile type from the archive header', () => {
    const root = dir();
    const mvt = archive(join(root, 'a.pmtiles'));
    const mlt = archive(join(root, 'b.pmtiles'), 6);
    writeFileSync(join(root, 'c.pmtiles'), 'short');
    expect([isMlt(mvt), isMlt(mlt), isMlt(join(root, 'c.pmtiles'))]).toEqual([false, true, false]);
    expect(tilesMinSdk([])).toBe('0.3.0');
    expect(tilesMinSdk([mvt])).toBe('0.3.0');
    expect(tilesMinSdk([mvt, mlt])).toBe('0.6.0');
    expect(tilesMinSdk([mlt], '0.7.1')).toBe('0.7.1');
  });
});

describe('nameMatchesFormat', () => {
  it('wants .mlt.pmtiles for MLT archives and a plain name for the rest', () => {
    const root = dir();
    const mvt = archive(join(root, 'a.pmtiles'));
    const mlt = archive(join(root, 'b.pmtiles'), 6);
    expect(nameMatchesFormat('16/tiles-1a2b3c4d.pmtiles', mvt)).toBe(true);
    expect(nameMatchesFormat('16/tiles-1a2b3c4d.mlt.pmtiles', mlt)).toBe(true);
    expect(nameMatchesFormat('16/tiles-1a2b3c4d.mlt.pmtiles', mvt)).toBe(false);
    expect(nameMatchesFormat('16/tiles-1a2b3c4d.pmtiles', mlt)).toBe(false);
  });
});

function featuresOf(path: string): { id: Uint8Array | null; tags: number[]; geometry: Uint8Array | null }[] {
  const archive = openPmtiles(path);
  const out = archive.entries.flatMap((entry) => decodeTile(gunzipSync(archive.read(entry))).layers.flatMap((bytes) => (decodeLayer(bytes) as MvtLayer).features));
  archive.close();
  return out.map(({ id, tags, geometry }) => ({ id, tags, geometry }));
}

describe('stripFeatureIds', () => {
  it('removes ids and nothing else', () => {
    const root = dir();
    const source = archive(join(root, 'in.pmtiles'));
    const target = join(root, 'out', 'plain.pmtiles');
    expect(stripFeatureIds(source, target)).toBe(1);
    const before = featuresOf(source)[0];
    const after = featuresOf(target)[0];
    expect(before?.id).not.toBeNull();
    expect(after).toEqual({ id: null, tags: before?.tags, geometry: before?.geometry });
    const a = openPmtiles(source);
    const b = openPmtiles(target);
    expect(b.header).toMatchObject({ ...a.header, dataOffset: expect.any(Number), dataLength: expect.any(Number), rootLength: expect.any(Number), metadataLength: expect.any(Number), metadataOffset: expect.any(Number), leafOffset: expect.any(Number) });
    expect(b.metadata).toEqual(a.metadata);
    a.close();
    b.close();
  });

  it('leaves a layer it cannot write back the same way as it was', () => {
    const root = dir();
    const odd = Uint8Array.from([...encodeLayer({ name: 'x', version: 2, extent: 4096, keys: [], values: [], features: [], order: [15, 1, 4, 5] }), 48, 1]);
    writePmtiles(join(root, 'in.pmtiles'), info, {}, [{ tileId: tileIdOf(14, 9500, 6100), data: gzipStable(encodeTile([odd])) }]);
    expect(stripFeatureIds(join(root, 'in.pmtiles'), join(root, 'out.pmtiles'))).toBe(0);
    const out = openPmtiles(join(root, 'out.pmtiles'));
    expect(Buffer.from(decodeTile(gunzipSync(out.read(out.entries[0]!))).layers[0]!).equals(Buffer.from(odd))).toBe(true);
    out.close();
  });
});

describe('encodeMlt and feature ids', () => {
  it('hands the tool a copy without ids, because the phone decoders cannot read plain id streams', async () => {
    const root = dir();
    const source = archive(join(root, 'in.pmtiles'));
    const seen: { idsInInput: number; path: string }[] = [];
    const run: Runner = async (_cmd, args) => {
      const input = args[args.length - 2] as string;
      seen.push({ idsInInput: featuresOf(input).filter((f) => f.id !== null).length, path: input });
      archive(args[args.length - 1] as string, 6);
      return { code: 0, out: '' };
    };
    await encodeMlt({ source, target: join(root, 'out.pmtiles'), run });
    await encodeMlt({ source, target: join(root, 'kept.pmtiles'), run, keepIds: true });
    expect(seen.map((s) => s.idsInInput)).toEqual([0, 1]);
    expect(seen[0]?.path).not.toBe(source);
    expect(seen[1]?.path).toBe(source);
    expect(readdirSync(root).sort()).toEqual(['in.pmtiles', 'kept.pmtiles', 'out.pmtiles']);
  });
});

describe('the mlt call', () => {
  it('asks for plain integer and string encodings, which the phone decoders read, and checks the result', async () => {
    const root = dir();
    const source = archive(join(root, 'in.pmtiles'));
    const seen: string[][] = [];
    const run: Runner = async (cmd, args) => {
      seen.push([cmd, ...args]);
      archive(args[args.length - 1] as string, 6);
      return { code: 0, out: '' };
    };
    await encodeMlt({ source, target: join(root, 'out.pmtiles'), run });
    expect(seen[0]?.slice(0, 2)).toEqual([mltBin, 'convert']);
    expect(seen[0]).toEqual(expect.arrayContaining(['--no-fastpfor', '--no-fsst', '--verify', '--tessellate=off', '--tile-compression', 'gzip']));
    expect(seen[0]?.[seen[0].length - 2]).toMatch(/out\.pmtiles\.ids\.pmtiles$/);
  });
});

describe('encodeMlt', () => {
  it('converts into place and leaves no temporary file', async () => {
    const root = dir();
    const source = archive(join(root, 'in.pmtiles'));
    const target = join(root, 'out', 'tiles.pmtiles');
    await encodeMlt({ source, target, run: fakeMlt() });
    expect(isMlt(target)).toBe(true);
    expect(readdirSync(join(root, 'out'))).toEqual(['tiles.pmtiles']);
  });

  it('fails when the tool fails or writes something else', async () => {
    const root = dir();
    const source = archive(join(root, 'in.pmtiles'));
    await expect(encodeMlt({ source, target: join(root, 'x.pmtiles'), run: fakeMlt(1) })).rejects.toThrow(/convert failed/);
    await expect(encodeMlt({ source, target: join(root, 'y.pmtiles'), run: fakeMlt(0, 1) })).rejects.toThrow(/MLT arşivi değil/);
    expect(readdirSync(root).sort()).toEqual(['in.pmtiles']);
  });

  (existsSync(mltBin) ? it : it.skip)('runs the pinned mlt tool on a real archive', async () => {
    const root = dir();
    const source = archive(join(root, 'in.pmtiles'));
    const target = join(root, 'out.pmtiles');
    await encodeMlt({ source, target });
    expect(isMlt(target)).toBe(true);
    if (existsSync(pmtilesBin)) expect(spawnSync(pmtilesBin, ['verify', target], { encoding: 'utf8' }).status).toBe(0);
    const out = openPmtiles(target);
    expect(out.entries.map((e) => e.tileId)).toEqual([tileIdOf(14, 9500, 6100)]);
    out.close();
  });
});

describe('encodeAll', () => {
  it('encodes what exists and removes outputs whose source is gone', async () => {
    const root = dir();
    const source = archive(join(root, 'tiles.pmtiles'));
    const stale = join(root, 'old-places.pmtiles');
    copyFileSync(source, stale);
    const count = await encodeAll({
      plates: ['16'],
      files: () => [
        { source, target: join(root, 'out', 'tiles.pmtiles') },
        { source: join(root, 'missing.pmtiles'), target: stale },
      ],
      run: fakeMlt(),
    });
    expect(count).toBe(1);
    expect(isMlt(join(root, 'out', 'tiles.pmtiles'))).toBe(true);
    expect(existsSync(stale)).toBe(false);
  });
});
