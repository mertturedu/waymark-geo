import { sliceShare, trafficRouteFeatures } from '../../src/native/logic/traffic-route';
import type { LngLat } from '../../src/core/geo/cells';

const line: LngLat[] = [[29, 41], [29.01, 41], [29.02, 41], [29.03, 41]];

describe('traffic route features', () => {
  it('cuts a line by the share of its length', () => {
    const middle = sliceShare(line, 1 / 3, 2 / 3);
    expect(middle[0]?.[0]).toBeCloseTo(29.01, 4);
    expect(middle[middle.length - 1]?.[0]).toBeCloseTo(29.02, 4);
    const half = sliceShare(line, 0, 0.5);
    expect(half[half.length - 1]?.[0]).toBeCloseTo(29.015, 4);
    expect(sliceShare(line, 0.5, 0.5)).toEqual([]);
    expect(sliceShare([[29, 41]], 0, 1)).toEqual([]);
  });

  it('keeps the whole route as one smooth piece without spans', () => {
    const collection = trafficRouteFeatures(line, undefined);
    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]?.properties.band).toBe('smooth');
    expect(collection.features[0]?.geometry.coordinates).toHaveLength(4);
  });

  it('makes one feature per span with its band', () => {
    const collection = trafficRouteFeatures(line, [{ band: 'smooth', from: 0, to: 0.4 }, { band: 'heavy', from: 0.4, to: 0.7 }, { band: 'jam', from: 0.7, to: 1 }]);
    expect(collection.features.map((feature) => feature.properties.band)).toEqual(['smooth', 'heavy', 'jam']);
    expect(trafficRouteFeatures([], undefined).features).toEqual([]);
  });
});
