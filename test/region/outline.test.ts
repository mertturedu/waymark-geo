import { createBorders, encodeBorders } from '../../src/core/region/borders';
import { embeddedBorders } from '../../src/core/region/embedded';
import type { Polygon } from '../../src/core/region/geom';
import { regionOutlines } from '../../src/core/region/outline';
import { fadeLevel, isMissing, missingAt, missingPlates, regionBytes, removedPlates } from '../../src/native/logic/missing-regions';

const square = (x: number, y: number, size: number): Polygon => [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]];

describe('regionOutlines', () => {
  const borders = createBorders(encodeBorders([{ plate: '16', rings: [square(29, 40, 1)] }, { plate: '54', rings: [square(30, 40, 1), square(32, 40, 1)] }]));

  it('turns a province into a multipolygon feature keyed by plate', () => {
    const collection = regionOutlines(borders, ['54']);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]).toMatchObject({ id: 54, properties: { plate: '54' }, geometry: { type: 'MultiPolygon' } });
    expect(collection.features[0]!.geometry.coordinates).toHaveLength(2);
  });

  it('skips plates without a border and keeps rings closed', () => {
    expect(regionOutlines(borders, ['99', '07']).features).toHaveLength(0);
    for (const ring of regionOutlines(borders, ['16']).features[0]!.geometry.coordinates[0]!) expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('draws every embedded province', () => {
    const all = embeddedBorders();
    const collection = regionOutlines(all, all.plates());
    expect(collection.features).toHaveLength(81);
    expect(collection.features.find((feature) => feature.properties.plate === '54')).toBeDefined();
  });
});

describe('missing regions', () => {
  const regions = [{ id: '16' }, { id: '54' }, { id: '34' }];
  const states: Record<string, string> = { '16': 'installed', '54': 'none', '34': 'update-available' };
  const stateOf = (id: string) => states[id] ?? 'none';

  it('treats installed and updatable regions as present', () => {
    expect(isMissing('installed')).toBe(false);
    expect(isMissing('update-available')).toBe(false);
    for (const state of ['none', 'queued', 'downloading', 'paused', 'verifying', 'error']) expect(isMissing(state)).toBe(true);
    expect(missingPlates(regions, stateOf)).toEqual(['54']);
  });

  it('finds the missing province under a point', () => {
    const borders = createBorders(encodeBorders([{ plate: '16', rings: [square(29, 40, 1)] }, { plate: '54', rings: [square(30.5, 40, 1)] }]));
    expect(missingAt(borders, regions, stateOf, 31, 40.5)).toBe('54');
    expect(missingAt(borders, regions, stateOf, 29.5, 40.5)).toBeNull();
    expect(missingAt(borders, regions, stateOf, 10, 10)).toBeNull();
  });

  it('adds up what a download really transfers', () => {
    const file = (size: number, encoded?: number) => ({ kind: 'tiles' as const, path: 'x', size, sha256: 'a'.repeat(64), ...(encoded ? { encoded: { codec: 'zstd' as const, path: 'x.zst', size: encoded, sha256: 'b'.repeat(64) } } : {}) });
    expect(regionBytes({ files: [file(100), file(300, 120)] })).toBe(220);
    expect(regionBytes({ files: [file(100), file(300, 120)] }, false)).toBe(400);
  });
});

describe('removedPlates', () => {
  it('lists provinces that stopped being missing', () => {
    expect(removedPlates(['16', '54', '77'], ['16', '77'])).toEqual(['54']);
    expect(removedPlates(['16'], ['16', '54'])).toEqual([]);
    expect(removedPlates([], [])).toEqual([]);
  });
});

describe('fadeLevel', () => {
  it('eases from fully visible to gone', () => {
    expect(fadeLevel(0, 1000)).toBe(1);
    expect(fadeLevel(500, 1000)).toBeCloseTo(0.5, 5);
    expect(fadeLevel(1000, 1000)).toBe(0);
    expect(fadeLevel(2000, 1000)).toBe(0);
    expect(fadeLevel(-50, 1000)).toBe(1);
    expect(fadeLevel(250, 1000)).toBeGreaterThan(fadeLevel(750, 1000));
  });
});
