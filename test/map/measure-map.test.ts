import { exprNodes, styleFor, styleStats, styleTable } from '../../scripts/measure-map';
import type { MapStyle } from '../../src/native/map/style';

describe('map measurement', () => {
  it('counts expression nodes', () => {
    expect(exprNodes(null)).toBe(0);
    expect(exprNodes('a')).toBe(0);
    expect(exprNodes(['get', 'name'])).toBe(1);
    expect(exprNodes(['case', ['==', ['get', 'a'], 1], 'x', 'y'])).toBe(3);
  });

  it('reads layers, sources, size and the largest expression of a small style', () => {
    const style = {
      version: 8,
      sources: { a: { type: 'vector' }, b: { type: 'vector' } },
      layers: [
        { id: 'one', type: 'line', source: 'a', filter: ['==', ['get', 'k'], 1] },
        { id: 'two', type: 'symbol', source: 'b', layout: { 'icon-image': ['case', ['has', 'x'], ['get', 'x'], ['concat', 'a', ['get', 'y']]] } },
      ],
    } as unknown as MapStyle;
    const stats = styleStats(style);
    expect(stats.layers).toBe(2);
    expect(stats.sources).toBe(2);
    expect(stats.bytes).toBe(JSON.stringify(style).length);
    expect(stats.largest).toEqual({ layer: 'two', field: 'layout.icon-image', nodes: 5 });
    expect(stats.heaviestLayer?.layer).toBe('two');
  });

  it('grows the style with every installed province', () => {
    const one = styleStats(styleFor(1));
    const two = styleStats(styleFor(2));
    expect(two.layers).toBeGreaterThan(one.layers);
    expect(two.sources).toBe(one.sources + 2);
  });

  it('writes one table row per province count', () => {
    expect(styleTable([1, 2])).toHaveLength(4);
  });
});
