import fc from 'fast-check';
import { encodedPaths, finalPath, installedPaths, manifestPaths, partPath, partsOf } from '../../src/core/packs/paths';
import { emptyState, type PackState } from '../../src/core/packs/state-file';
import type { Manifest, ManifestFile } from '../../src/core/region/manifest';

const sha = (c: string): string => c.repeat(64);

const plain = (path: string): ManifestFile => ({ kind: 'address', path, size: 10, sha256: sha('a') });
const packed = (path: string): ManifestFile => ({ ...plain(path), encoded: { codec: 'zstd', path: `${path}.zst`, size: 4, sha256: sha('b') } });

const manifestOf = (base: ManifestFile[], regions: ManifestFile[][]): Manifest => ({
  format: 1,
  minSdk: '0.1.0',
  osm: { file: 'turkey-261020.osm.pbf', time: '2026-10-20T20:23:47Z' },
  tiles: { build: '20261022', time: '2026-10-22T04:00:00Z' },
  base,
  regions: regions.map((files, index) => ({ id: String(34 + index), tier: 'full', names: { tr: 'Il' }, bbox: [27, 40, 30, 42], version: '20261020.20261022', stats: { addresses: 1, streets: 1, neighbourhoods: 1 }, files })),
});

const stateWith = (patch: Partial<PackState>): PackState => ({ ...emptyState(), ...patch });

describe('pack paths', () => {
  it('puts finished files under files/ and half downloaded ones under .part/ with the slashes flattened', () => {
    expect(finalPath('34/address-0a0b0c0d.sqlite')).toBe('files/34/address-0a0b0c0d.sqlite');
    expect(partPath('34/address-0a0b0c0d.sqlite')).toBe('.part/34__address-0a0b0c0d.sqlite');
    expect(partPath('base-20261022/sprites/v4/light.json')).toBe('.part/base-20261022__sprites__v4__light.json');
  });

  it('lists the paths of the zstd copy of a file and none for a plain file', () => {
    expect(encodedPaths(plain('34/address-0a0b0c0d.sqlite'))).toEqual([]);
    expect(encodedPaths(packed('34/address-0a0b0c0d.sqlite'))).toEqual(['files/34/address-0a0b0c0d.sqlite.zst', '.part/34__address-0a0b0c0d.sqlite.zst']);
  });

  describe('installedPaths', () => {
    it('is empty before anything is installed', () => {
      expect(installedPaths(emptyState()).size).toBe(0);
    });

    it('holds every installed file of every region and of the base map, and nothing that is only pending', () => {
      const state = stateWith({
        regions: {
          '34': { version: '1', files: { address: { path: '34/address-0a0b0c0d.sqlite', size: 5, sha256: sha('a') }, tiles: { path: '34/tiles-11223344.pmtiles', size: 9, sha256: sha('b') } } },
          '35': { version: '1', files: { address: { path: '35/address-aabbccdd.sqlite', size: 5, sha256: sha('c') } } },
        },
        base: { build: '20261022', files: [{ path: 'base-20261022/overview.pmtiles', size: 3, sha256: sha('d') }] },
        pending: { '06': { parts: ['address'] } },
      });
      expect([...installedPaths(state)].sort()).toEqual(['files/34/address-0a0b0c0d.sqlite', 'files/34/tiles-11223344.pmtiles', 'files/35/address-aabbccdd.sqlite', 'files/base-20261022/overview.pmtiles']);
    });
  });

  describe('manifestPaths', () => {
    it('is empty without a manifest', () => {
      expect(manifestPaths(null, new Set(['files/34/x.sqlite'])).size).toBe(0);
    });

    it('lists the base files and the files of every region', () => {
      const manifest = manifestOf([{ ...plain('base-20261022/overview.pmtiles'), kind: 'base' }], [[plain('34/address-0a0b0c0d.sqlite')], [plain('35/address-aabbccdd.sqlite')]]);
      expect([...manifestPaths(manifest, new Set())].sort()).toEqual(['files/34/address-0a0b0c0d.sqlite', 'files/35/address-aabbccdd.sqlite', 'files/base-20261022/overview.pmtiles']);
    });

    it('keeps the zstd copy of a file that is not installed yet, so a finished download can still be opened', () => {
      const manifest = manifestOf([], [[packed('34/address-0a0b0c0d.sqlite')]]);
      expect([...manifestPaths(manifest, new Set())].sort()).toEqual(['files/34/address-0a0b0c0d.sqlite', 'files/34/address-0a0b0c0d.sqlite.zst']);
    });

    it('lets the zstd copy of an installed file go', () => {
      const manifest = manifestOf([], [[packed('34/address-0a0b0c0d.sqlite')]]);
      expect([...manifestPaths(manifest, new Set(['files/34/address-0a0b0c0d.sqlite']))]).toEqual(['files/34/address-0a0b0c0d.sqlite']);
    });

    it('keeps the zstd copy of a base file as well', () => {
      const manifest = manifestOf([{ ...packed('base-20261022/overview.pmtiles'), kind: 'base' }], []);
      expect([...manifestPaths(manifest, new Set())].sort()).toEqual(['files/base-20261022/overview.pmtiles', 'files/base-20261022/overview.pmtiles.zst']);
    });
  });

  describe('partsOf', () => {
    it('names the half downloaded file of each finished path, zstd copies included', () => {
      const manifest = manifestOf([], [[packed('34/address-0a0b0c0d.sqlite'), plain('34/tiles-11223344.pmtiles')]]);
      expect([...partsOf(manifestPaths(manifest, new Set()))].sort()).toEqual(['.part/34__address-0a0b0c0d.sqlite', '.part/34__address-0a0b0c0d.sqlite.zst', '.part/34__tiles-11223344.pmtiles']);
    });

    it('agrees with partPath for any path', () => {
      const piece = fc.stringMatching(/^[a-z0-9.-]{1,8}$/);
      fc.assert(
        fc.property(fc.array(piece, { minLength: 1, maxLength: 4 }), (pieces) => {
          const path = pieces.join('/');
          expect([...partsOf(new Set([finalPath(path)]))]).toEqual([partPath(path)]);
        }),
      );
    });
  });
});
