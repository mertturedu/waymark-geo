import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { MLT_SUFFIX } from '../../src/core/region/manifest';
import { buildStyle } from '../../src/native/map/style';

const style = (tilesPath: string, placesPath?: string) =>
  buildStyle({ rootUrl: 'file:///docs/', baseDir: 'files/base-20261030', regions: [{ id: '16', tilesPath, ...(placesPath ? { placesPath } : {}) }], theme: 'light', lang: 'tr' });

describe('MLT tiles in the style', () => {
  it('reads an archive whose name ends in .mlt.pmtiles as MLT', () => {
    const built = style(`files/16/tiles-1a2b3c4d${MLT_SUFFIX}`, `files/16/places-5e6f7a8b${MLT_SUFFIX}`);
    expect(built.sources.r16).toMatchObject({ type: 'vector', encoding: 'mlt', maxzoom: 15 });
    expect(built.sources.ov16).toMatchObject({ type: 'vector', encoding: 'mlt', maxzoom: 16 });
    expect(built.sources.base).not.toHaveProperty('encoding');
    expect(validateStyleMin(built as never).map((e) => e.message)).toEqual([]);
  });

  it('leaves vector tiles as they were', () => {
    const built = style('files/16/tiles-1a2b3c4d.pmtiles', 'files/16/places-5e6f7a8b.pmtiles');
    expect(built.sources.r16).not.toHaveProperty('encoding');
    expect(built.sources.ov16).not.toHaveProperty('encoding');
  });

  it('mixes provinces of both kinds', () => {
    const built = buildStyle({ rootUrl: 'file:///docs/', baseDir: 'files/base-20261030', regions: [{ id: '16', tilesPath: `files/16/t${MLT_SUFFIX}` }, { id: '34', tilesPath: 'files/34/t.pmtiles' }], theme: 'dark', lang: 'en' });
    expect(built.sources.r16).toHaveProperty('encoding', 'mlt');
    expect(built.sources.r34).not.toHaveProperty('encoding');
    expect(validateStyleMin(built as never).map((e) => e.message)).toEqual([]);
  });
});

describe('streamed regions', () => {
  const remote = (tilesPath: string, placesPath?: string) =>
    buildStyle({
      rootUrl: 'file:///docs/',
      baseDir: 'files/base-20261030',
      tileUrl: 'https://tiles.example.com/',
      regions: [{ id: '34', tilesPath, ...(placesPath ? { placesPath } : {}), remote: [27.97, 40.74, 29.96, 41.67] }],
      theme: 'light',
      lang: 'tr',
    });

  it('reads an MLT region from the tile server by z/x/y', () => {
    const built = remote(`34/tiles-6f086fc5${MLT_SUFFIX}`, `34/places-4f90a14b${MLT_SUFFIX}`);
    expect(built.sources.r34).toMatchObject({ type: 'vector', encoding: 'mlt', minzoom: 0, maxzoom: 15, bounds: [27.97, 40.74, 29.96, 41.67], tiles: ['https://tiles.example.com/34/tiles-6f086fc5.mlt/{z}/{x}/{y}.mlt'] });
    expect(built.sources.r34).not.toHaveProperty('url');
    expect(built.sources.ov34).toMatchObject({ maxzoom: 16, tiles: ['https://tiles.example.com/34/places-4f90a14b.mlt/{z}/{x}/{y}.mlt'] });
    expect(validateStyleMin(built as never).map((e) => e.message)).toEqual([]);
  });

  it('asks for .mvt when the archive is plain vector tiles', () => {
    const built = remote('34/tiles-6f086fc5.pmtiles');
    expect(built.sources.r34).toMatchObject({ tiles: ['https://tiles.example.com/34/tiles-6f086fc5/{z}/{x}/{y}.mvt'] });
    expect(built.sources.r34).not.toHaveProperty('encoding');
  });

  it('keeps the base and the installed regions on local files', () => {
    const built = buildStyle({
      rootUrl: 'file:///docs/',
      baseDir: 'files/base-20261030',
      tileUrl: 'https://tiles.example.com',
      regions: [{ id: '16', tilesPath: `files/16/t${MLT_SUFFIX}` }, { id: '34', tilesPath: `34/t${MLT_SUFFIX}`, remote: [27.97, 40.74, 29.96, 41.67] }],
      theme: 'light',
      lang: 'tr',
    });
    expect(built.sources.base).toHaveProperty('url');
    expect(built.sources.r16).toHaveProperty('url');
    expect(built.sources.r34).toHaveProperty('tiles');
  });

  it('falls back to the file when no tile server is configured', () => {
    const built = buildStyle({ rootUrl: 'file:///docs/', baseDir: 'files/base-20261030', regions: [{ id: '34', tilesPath: `34/t${MLT_SUFFIX}`, remote: [27.97, 40.74, 29.96, 41.67] }], theme: 'light', lang: 'tr' });
    expect(built.sources.r34).toHaveProperty('url');
  });
});
