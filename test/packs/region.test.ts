import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ringAround } from '../../src/core/geo/distance';
import { decideAuto, detectRegion, NEAR_BORDER_M } from '../../src/core/packs/region';
import { createBorders, encodeBorders } from '../../src/core/region/borders';
import type { Polygon, Ring } from '../../src/core/region/geom';

const real = createBorders(new Uint8Array(readFileSync(join(__dirname, '../../src/core/region/data/borders.bin'))));
const square = (west: number, south: number, east: number, north: number): Ring => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const two = createBorders(encodeBorders([{ plate: '34', rings: [[square(28, 40, 29, 41)]] as Polygon[] }, { plate: '41', rings: [[square(29, 40, 30, 41)]] as Polygon[] }, { plate: '06', rings: [[square(32, 39, 33, 40)]] as Polygon[] }]));

const random = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

describe('detectRegion', () => {
  it('names the province and the neighbours within a kilometre', () => {
    expect(NEAR_BORDER_M).toBe(1000);
    expect(detectRegion(two, [28.5, 40.5])).toEqual({ region: '34', nearBorder: [] });
    expect(detectRegion(two, [28.999, 40.5])).toEqual({ region: '34', nearBorder: ['41'] });
    expect(detectRegion(two, [29.001, 40.5])).toEqual({ region: '41', nearBorder: ['34'] });
    expect(detectRegion(two, [32.5, 39.5])).toEqual({ region: '06', nearBorder: [] });
  });

  it('has no province for the sea and other countries', () => {
    expect(detectRegion(two, [35, 45])).toEqual({ region: null, nearBorder: [] });
  });

  it.each([[null], [undefined], [[]], [[1]], [[Number.NaN, 40]], [[28, Infinity]], [['28', '40']], [[200, 40]], [[28, 95]], ['28,40'], [{ lng: 28, lat: 40 }]])('does not throw on %j', (point) => {
    expect(detectRegion(two, point as never)).toEqual({ region: null, nearBorder: [] });
  });
});

describe('detectRegion on the 81 real province borders (K5.2)', () => {
  it('finds the right province for 10 000 points at least 200 m from any border', () => {
    const next = random(2026);
    const plates = real.plates();
    expect(plates).toHaveLength(81);
    let checked = 0;
    let wrong = 0;
    for (const plate of plates) {
      const [west, south, east, north] = real.provinceBounds(plate) as [number, number, number, number];
      let found = 0;
      let tries = 0;
      const wanted = Math.ceil(10_000 / 81);
      while (found < wanted && tries < 200_000) {
        tries += 1;
        const point: [number, number] = [west + next() * (east - west), south + next() * (north - south)];
        if (real.provinceAt(point[0], point[1]) !== plate) continue;
        if (ringAround(point, 200).some((p) => real.provinceAt(p[0], p[1]) !== plate)) continue;
        found += 1;
        checked += 1;
        if (detectRegion(real, point).region !== plate) wrong += 1;
      }
      expect(found).toBeGreaterThan(0);
    }
    expect(checked).toBeGreaterThanOrEqual(9_000);
    expect(wrong).toBe(0);
  }, 120_000);

  it('lists a neighbour whenever one lies within 700 m in any of the eight directions', () => {
    const next = random(7);
    let hits = 0;
    for (let i = 0; i < 30_000 && hits < 400; i++) {
      const plates = real.plates();
      const plate = plates[Math.floor(next() * plates.length)] as string;
      const [west, south, east, north] = real.provinceBounds(plate) as [number, number, number, number];
      const point: [number, number] = [west + next() * (east - west), south + next() * (north - south)];
      const own = real.provinceAt(point[0], point[1]);
      if (!own) continue;
      const seen = ringAround(point, 700).map((p) => real.provinceAt(p[0], p[1])).filter((p): p is string => p !== null && p !== own);
      if (seen.length === 0) continue;
      hits += 1;
      const detected = detectRegion(real, point);
      expect(detected.region).toBe(own);
      for (const other of seen) expect(detected.nearBorder).toContain(other);
    }
    expect(hits).toBeGreaterThanOrEqual(100);
  }, 120_000);

  it('lists nobody when every direction up to 1.5 km stays in the same province', () => {
    const next = random(11);
    let checked = 0;
    for (let i = 0; i < 30_000 && checked < 200; i++) {
      const plates = real.plates();
      const plate = plates[Math.floor(next() * plates.length)] as string;
      const [west, south, east, north] = real.provinceBounds(plate) as [number, number, number, number];
      const point: [number, number] = [west + next() * (east - west), south + next() * (north - south)];
      if (real.provinceAt(point[0], point[1]) !== plate) continue;
      if ([...ringAround(point, 1500), ...ringAround(point, 700), ...ringAround(point, 1200)].some((p) => real.provinceAt(p[0], p[1]) !== plate)) continue;
      checked += 1;
      expect(detectRegion(real, point).nearBorder).toEqual([]);
    }
    expect(checked).toBeGreaterThanOrEqual(100);
  }, 120_000);
});

describe('decideAuto', () => {
  const base = { borders: two, installed: [] as string[], dismissed: [] as string[] };

  it('does nothing without a location, and nothing at all when automatic download is never', () => {
    expect(decideAuto({ ...base, location: null, autoDownload: 'ask' })).toEqual({ action: 'none', regions: [], neighbours: [] });
    expect(decideAuto({ ...base, location: [28.5, 40.5], autoDownload: 'never' })).toEqual({ action: 'none', regions: [], neighbours: [] });
    expect(decideAuto({ ...base, location: [35, 45], autoDownload: 'always' })).toEqual({ action: 'none', regions: [], neighbours: [] });
  });

  it('suggests the province the person is in when asking', () => {
    expect(decideAuto({ ...base, location: [28.5, 40.5], autoDownload: 'ask' })).toEqual({ action: 'suggest', regions: ['34'], neighbours: [] });
  });

  it('downloads the province itself on always and wifi, and only suggests the neighbour', () => {
    for (const autoDownload of ['always', 'wifi'] as const) {
      expect(decideAuto({ ...base, location: [28.999, 40.5], autoDownload })).toEqual({ action: 'download', regions: ['34'], neighbours: ['41'] });
    }
  });

  it('suggests the neighbour near the border when the own province is installed', () => {
    expect(decideAuto({ ...base, installed: ['34'], location: [28.999, 40.5], autoDownload: 'ask' })).toEqual({ action: 'suggest', regions: [], neighbours: ['41'] });
    expect(decideAuto({ ...base, installed: ['34'], location: [28.999, 40.5], autoDownload: 'always' })).toEqual({ action: 'suggest', regions: [], neighbours: ['41'] });
  });

  it('asks about nothing that is installed or was turned down', () => {
    expect(decideAuto({ ...base, installed: ['34'], location: [28.5, 40.5], autoDownload: 'ask' })).toEqual({ action: 'none', regions: [], neighbours: [] });
    expect(decideAuto({ ...base, dismissed: ['34'], location: [28.5, 40.5], autoDownload: 'always' })).toEqual({ action: 'none', regions: [], neighbours: [] });
    expect(decideAuto({ ...base, installed: ['34'], dismissed: ['41'], location: [28.999, 40.5], autoDownload: 'ask' })).toEqual({ action: 'none', regions: [], neighbours: [] });
  });

  it('is deterministic and never throws for any location', () => {
    fc.assert(
      fc.property(fc.anything(), fc.constantFrom('ask', 'wifi', 'always', 'never'), (location, autoDownload) => {
        const result = decideAuto({ ...base, location: location as never, autoDownload });
        expect(['none', 'suggest', 'download']).toContain(result.action);
        expect(decideAuto({ ...base, location: location as never, autoDownload })).toEqual(result);
      }),
    );
  });
});
