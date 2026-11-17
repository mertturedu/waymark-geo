import { buildStyle, TRAFFIC_COLOURS, trafficLayers, type StyleInput, type StyleLayer } from '../../src/native/map/style';

const regions = [{ id: '34', tilesPath: 'tiles-a.pmtiles' }, { id: '75', tilesPath: 'tiles-b.pmtiles' }];
const input = (extra: Partial<StyleInput> = {}): StyleInput => ({ rootUrl: 'file:///root', baseDir: 'base-1', regions, theme: 'light', lang: 'tr', ...extra });
const find = (style: { layers: StyleLayer[] }, id: string) => style.layers.find((l) => l.id === id);
const rush = Date.UTC(2026, 10, 9) + 5 * 3_600_000;
const night = Date.UTC(2026, 10, 9);

describe('traffic on the roads of the map', () => {
  it('is not in the style unless it is asked for', () => {
    expect(buildStyle(input()).layers.some((layer) => layer.id.startsWith('traffic@'))).toBe(false);
  });

  it('colours the busy road kinds red in the rush hour and leaves the calm ones alone', () => {
    const style = buildStyle(input({ traffic: { at: rush } }));
    const layer = find(style, 'traffic@r34');
    expect(layer).toMatchObject({ type: 'line', source: 'r34', 'source-layer': 'roads' });
    const colour = layer?.paint?.['line-color'] as unknown[];
    expect(colour).toContain(TRAFFIC_COLOURS.jam);
    expect(colour.slice(0, 2)).toEqual(['match', ['get', 'kind']]);
    expect(layer?.filter).toEqual(['in', ['get', 'kind'], ['literal', expect.arrayContaining(['highway', 'major_road'])]]);
    expect((layer?.filter as unknown[][])[2]?.[1]).not.toContain('minor_road');
  });

  it('is lighter in a small province than in Istanbul', () => {
    const istanbul = trafficLayers('r34', '34', rush)[1]?.paint?.['line-color'] as string[];
    const small = trafficLayers('r75', '75', rush)[1]?.paint?.['line-color'] as string[];
    expect(istanbul.includes(TRAFFIC_COLOURS.jam)).toBe(true);
    expect(small.includes(TRAFFIC_COLOURS.jam)).toBe(false);
  });

  it('has nothing to draw at night', () => {
    expect(trafficLayers('r34', '34', night)).toEqual([]);
    expect(buildStyle(input({ traffic: { at: night } })).layers.some((layer) => layer.id.startsWith('traffic@'))).toBe(false);
  });

  it('draws under the labels of the same province', () => {
    const layers = buildStyle(input({ traffic: { at: rush } })).layers;
    const at = layers.findIndex((layer) => layer.id === 'traffic@r34');
    const firstLabel = layers.findIndex((layer) => layer.source === 'r34' && layer.type === 'symbol');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(firstLabel);
    const road = layers.findIndex((layer) => layer.source === 'r34' && layer['source-layer'] === 'roads' && layer.type === 'line');
    expect(at).toBeGreaterThan(road);
  });

  it('thickens with the zoom and follows the road kind', () => {
    const width = trafficLayers('r34', '34', rush)[1]?.paint?.['line-width'] as unknown[];
    expect(width.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    expect(width[3]).toBe(8);
    expect(width.filter((entry) => Array.isArray(entry) && entry[0] === 'match')).toHaveLength(4);
  });

  it('shows from far away as a soft translucent glow under the sharp line', () => {
    const [glow, line] = trafficLayers('r34', '34', rush);
    expect(glow).toMatchObject({ id: 'traffic-glow@r34', type: 'line', source: 'r34', 'source-layer': 'roads', minzoom: 6, maxzoom: 16 });
    expect(line).toMatchObject({ id: 'traffic@r34', minzoom: 8 });
    expect(glow?.filter).toEqual(line?.filter);
    expect(glow?.paint?.['line-color']).toEqual(line?.paint?.['line-color']);
    expect(glow?.paint?.['line-blur']).toEqual(['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6, 15, 8]);
    const opacity = glow?.paint?.['line-opacity'] as unknown[];
    expect(opacity.slice(3).filter((_, i) => i % 2 === 1).every((value) => (value as number) <= 0.4)).toBe(true);
    const layers = buildStyle(input({ traffic: { at: rush } })).layers;
    expect(layers.findIndex((layer) => layer.id === 'traffic-glow@r34')).toBe(layers.findIndex((layer) => layer.id === 'traffic@r34') - 1);
  });
});
