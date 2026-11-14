import { createGeoNative, MAX_STREAMED } from '../../src/native/platform/create';

const mockRegions = [
  { id: '34', bbox: [27.97, 40.74, 29.96, 41.67], files: [{ kind: 'tiles', path: '34/tiles-6f086fc5.mlt.pmtiles' }, { kind: 'places', path: '34/places-4f90a14b.mlt.pmtiles' }, { kind: 'route', path: '34/route-8fecd1c3.bin' }] },
  { id: '41', bbox: [29.32, 40.52, 30.51, 41.42], files: [{ kind: 'tiles', path: '41/tiles-aa.mlt.pmtiles' }] },
  { id: '06', bbox: [31.4, 39.1, 33.2, 40.6], files: [{ kind: 'tiles', path: '06/tiles-e38a52f2.mlt.pmtiles' }] },
  { id: '77', bbox: [29.0, 40.0, 29.5, 40.5], files: [{ kind: 'places', path: '77/places-bb.mlt.pmtiles' }] },
];
let mockInstalled: string[] = [];
let mockBaseReady = true;
const mockDownloadBase = jest.fn(async () => undefined);

jest.mock('expo-file-system', () => ({
  Directory: class {
    exists = true;
    uri = 'file:///docs/yuksi-geo/';
    create() {}
  },
  Paths: { document: {} },
}));
jest.mock('../../src/native/platform/fs', () => ({ createExpoFs: () => ({}) }));
jest.mock('../../src/native/platform/hash', () => ({ createExpoHash: () => ({}) }));
jest.mock('../../src/native/platform/learn-store', () => ({ createExpoLearnStore: () => ({}) }));
jest.mock('../../src/native/platform/network', () => ({ createExpoNet: () => ({}) }));
jest.mock('../../src/native/platform/sqlite', () => ({ createExpoOpener: () => ({}) }));
jest.mock('../../src/native/platform/connectivity', () => ({ createExpoConnectivity: () => ({}) }));
jest.mock('../../src/core/packs/zstd', () => ({ createZstdDecode: () => ({}) }));
jest.mock('../../src/core/create-geo', () => ({
  createGeo: async () => ({
    regions: {
      list: () => mockRegions,
      installed: () => mockInstalled,
      baseDir: () => 'base-20261030',
      baseReady: () => mockBaseReady,
      downloadBase: (...args: unknown[]) => mockDownloadBase(...(args as [])),
      installedFile: (id: string, kind: string) => (mockInstalled.includes(id) ? `files/${id}/${kind}-x.mlt.pmtiles` : null),
    },
  }),
}));

const config = { manifestUrl: 'https://packs.example.com/manifest-v1.json', publicKeys: [] };
const make = (tiles = true) => createGeoNative({ ...config, ...(tiles ? { tiles: { url: 'https://tiles.example.com' } } : {}) });
const ISTANBUL: [number, number] = [28.98, 41.01];

describe('map.stream', () => {
  beforeEach(() => {
    mockInstalled = [];
    mockBaseReady = true;
    mockDownloadBase.mockClear();
  });

  it('streams nothing until the app says where it is looking', async () => {
    const geo = await make();
    expect(geo.map.stream.active()).toEqual([]);
    expect(geo.map.style({ theme: 'light' }).sources).not.toHaveProperty('r34');
  });

  it('streams the province around the focus when it is not installed', async () => {
    const geo = await make();
    geo.map.stream.set([ISTANBUL]);
    expect(geo.map.stream.active()).toEqual(['34']);
    const style = geo.map.style({ theme: 'light' });
    expect(style.sources.r34).toMatchObject({ tiles: ['https://tiles.example.com/34/tiles-6f086fc5.mlt/{z}/{x}/{y}.mlt'] });
    expect(style.sources.ov34).toMatchObject({ tiles: ['https://tiles.example.com/34/places-4f90a14b.mlt/{z}/{x}/{y}.mlt'] });
  });

  it('uses the file once the province is installed', async () => {
    const geo = await make();
    geo.map.stream.set([ISTANBUL]);
    mockInstalled = ['34'];
    expect(geo.map.stream.active()).toEqual([]);
    expect(geo.map.style({ theme: 'light' }).sources.r34).toHaveProperty('url');
  });

  it('skips provinces that have no tile archive', async () => {
    const geo = await make();
    geo.map.stream.set([[29.2, 40.2]]);
    expect(geo.map.stream.active()).toEqual([]);
  });

  it('keeps the first focus point when the limit is reached', async () => {
    const geo = await make();
    geo.map.stream.set([[32, 40], [29.4, 40.9], ISTANBUL, [29.35, 41.0]]);
    expect(geo.map.stream.active()).toEqual(['06', '34', '41']);
  });

  it('does not stream more than the limit', async () => {
    const geo = await make();
    geo.map.stream.set([ISTANBUL, [29.4, 40.9], [32, 40]]);
    expect(geo.map.stream.active().length).toBeLessThanOrEqual(MAX_STREAMED);
    expect(geo.map.stream.active()).toEqual(['34', '41', '06']);
  });

  it('leaves the explicit list alone when the app limits the provinces', async () => {
    const geo = await make();
    geo.map.stream.set([ISTANBUL]);
    expect(geo.map.style({ theme: 'light', only: [] }).sources).not.toHaveProperty('r34');
  });

  it('streams nothing without a tile server', async () => {
    const geo = await make(false);
    geo.map.stream.set([ISTANBUL]);
    expect(geo.map.stream.active()).toEqual([]);
  });

  it('tells listeners only when the focus moves to another place', async () => {
    const geo = await make();
    const listener = jest.fn();
    const off = geo.map.stream.subscribe(listener);
    geo.map.stream.set([ISTANBUL]);
    geo.map.stream.set([[28.981, 41.011]]);
    expect(listener).toHaveBeenCalledTimes(1);
    geo.map.stream.set([[32, 40]]);
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    geo.map.stream.set([ISTANBUL]);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('fetches the base when streaming starts without one', async () => {
    mockBaseReady = false;
    const geo = await make();
    geo.map.stream.set([ISTANBUL]);
    expect(mockDownloadBase).toHaveBeenCalledWith({ allowCellular: true });
  });

  it('leaves the base alone when it is there already', async () => {
    const geo = await make();
    geo.map.stream.set([ISTANBUL]);
    expect(mockDownloadBase).not.toHaveBeenCalled();
  });

  it('does not fetch the base without a tile server or without a focus', async () => {
    mockBaseReady = false;
    const plain = await make(false);
    plain.map.stream.set([ISTANBUL]);
    const geo = await make();
    geo.map.stream.set([]);
    expect(mockDownloadBase).not.toHaveBeenCalled();
  });

  it('survives a failed base download', async () => {
    mockBaseReady = false;
    mockDownloadBase.mockRejectedValueOnce(new Error('network'));
    const geo = await make();
    expect(() => geo.map.stream.set([ISTANBUL])).not.toThrow();
    await Promise.resolve();
  });
});
