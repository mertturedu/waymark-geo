import { buildStyle, TRAFFIC_COLOURS, TRAFFIC_SMOOTH, trafficLayers, type StyleInput, type StyleLayer } from '../../src/native/map/style';

const regions = [{ id: '06', tilesPath: 'tiles-a.pmtiles' }, { id: '75', tilesPath: 'tiles-b.pmtiles' }];
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
    const layer = find(style, 'traffic@r06');
    expect(layer).toMatchObject({ type: 'line', source: 'r06', 'source-layer': 'roads' });
    const colour = layer?.paint?.['line-color'] as unknown[];
    expect(colour).toContain(TRAFFIC_COLOURS.jam);
    expect(colour.slice(0, 2)).toEqual(['match', ['get', 'kind']]);
    const filter = layer?.filter as unknown[][];
    expect(filter[0]).toBe('all');
    expect(filter[1]).toEqual(['in', ['get', 'kind'], ['literal', expect.arrayContaining(['highway', 'major_road'])]]);
    expect((filter[1] as unknown[][])[2]?.[1]).not.toContain('minor_road');
  });

  it('colours only some of the roads of a kind, and only parts of each', () => {
    const layers = trafficLayers('r06', '06', rush);
    const slow = layers.find((layer) => layer.id === 'traffic@r06');
    const dense = layers.find((layer) => layer.id === 'traffic-dense@r06');
    const share = (layer: StyleLayer | undefined): unknown[] => ((layer?.filter as unknown[][])[2] as unknown[]);
    expect(share(slow)[0]).toBe('<');
    expect(JSON.stringify(share(slow))).toContain('"name"');
    const limit = (JSON.stringify(share(slow)).match(/\],([0-9.]+)\]/g) ?? []).length;
    expect(limit).toBeGreaterThan(0);
    expect(JSON.stringify(slow?.filter)).toContain('>=');
    expect(JSON.stringify(dense?.filter)).not.toContain('>=');
    expect((slow?.paint?.['line-dasharray'] as number[])[1]).toBeGreaterThan((slow?.paint?.['line-dasharray'] as number[])[0] as number);
  });

  it('is lighter in a small province than in Ankara', () => {
    const ankara = trafficLayers('r06', '06', rush)[1]?.paint?.['line-color'] as string[];
    const small = trafficLayers('r75', '75', rush)[1]?.paint?.['line-color'] as string[];
    expect(ankara.includes(TRAFFIC_COLOURS.jam)).toBe(true);
    expect(small.includes(TRAFFIC_COLOURS.jam)).toBe(false);
  });

  it('draws only a light green flow on the big roads at night', () => {
    const layers = trafficLayers('r06', '06', night);
    expect(layers.map((layer) => layer.id)).toEqual(['traffic-flow@r06']);
    expect(layers[0]?.filter).toEqual(['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]]);
    expect(layers[0]?.paint?.['line-color']).toBe(TRAFFIC_SMOOTH);
    expect(buildStyle(input({ traffic: { at: night } })).layers.some((layer) => layer.id.startsWith('traffic@'))).toBe(false);
  });

  it('draws the slow roads as short dashes and the heavy ones denser and stronger', () => {
    const layers = trafficLayers('r06', '06', rush);
    const slow = layers.find((layer) => layer.id === 'traffic@r06');
    const dense = layers.find((layer) => layer.id === 'traffic-dense@r06');
    expect(slow?.paint?.['line-dasharray']).toEqual([9, 13]);
    expect(dense?.paint?.['line-dasharray']).toEqual([11, 9]);
    expect((dense?.paint?.['line-opacity'] as number)).toBeGreaterThan(slow?.paint?.['line-opacity'] as number);
    expect(TRAFFIC_COLOURS.jam).toBe('#D4142C');
  });

  it('draws under the labels of the same province', () => {
    const layers = buildStyle(input({ traffic: { at: rush } })).layers;
    const at = layers.findIndex((layer) => layer.id === 'traffic@r06');
    const firstLabel = layers.findIndex((layer) => layer.source === 'r06' && layer.type === 'symbol');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(firstLabel);
    const road = layers.findIndex((layer) => layer.source === 'r06' && layer['source-layer'] === 'roads' && layer.type === 'line');
    expect(at).toBeGreaterThan(road);
  });

  it('thickens with the zoom and follows the road kind', () => {
    const width = trafficLayers('r06', '06', rush)[1]?.paint?.['line-width'] as unknown[];
    expect(width.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    expect(width[3]).toBe(8);
    expect(width.filter((entry) => Array.isArray(entry) && entry[0] === 'match')).toHaveLength(4);
  });

  it('shows from far away as a soft translucent glow under the sharp line', () => {
    const [glow, line] = trafficLayers('r06', '06', rush);
    expect(glow).toMatchObject({ id: 'traffic-glow@r06', type: 'line', source: 'r06', 'source-layer': 'roads', minzoom: 6, maxzoom: 16 });
    expect(line).toMatchObject({ id: 'traffic@r06', minzoom: 8 });
    expect((glow?.filter as unknown[][])[1]).toEqual(['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]]);
    expect(JSON.stringify(glow?.paint?.['line-color'])).not.toContain('minor_road');
    expect(glow?.paint?.['line-blur']).toEqual(['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6, 15, 8]);
    const opacity = glow?.paint?.['line-opacity'] as unknown[];
    expect(opacity.slice(3).filter((_, i) => i % 2 === 1).every((value) => (value as number) <= 0.4)).toBe(true);
    const layers = buildStyle(input({ traffic: { at: rush } })).layers;
    expect(layers.findIndex((layer) => layer.id === 'traffic-glow@r06')).toBe(layers.findIndex((layer) => layer.id === 'traffic@r06') - 1);
  });

  it('colours Istanbul roads by the cell they lie in, and keeps the typical model for roads without one', () => {
    const tuesday = Date.UTC(2026, 10, 17, 15);
    const layers = trafficLayers('r34', '34', tuesday);
    const ids = layers.map((layer) => layer.id);
    expect(ids.some((id) => /^traffic-o\d+@r34$/.test(id))).toBe(true);
    const mine = layers.filter((layer) => /^traffic(-flow|-glow|-dense)?-o\d+@r34$/.test(layer.id));
    for (const layer of mine) expect(JSON.stringify(layer.filter)).toContain('"cell"');
    const fallback = layers.filter((layer) => layer.id.endsWith('-m@r34'));
    expect(fallback.length).toBeGreaterThan(0);
    for (const layer of fallback) expect(JSON.stringify(layer.filter)).toContain('"!"');
  });

  it('shows a busier cell with stronger colours than a calm one at the same time', () => {
    const layers = trafficLayers('r34', '34', Date.UTC(2026, 10, 17, 15));
    const levels = layers.map((layer) => /^traffic-o(\d+)@r34$/.exec(layer.id)).filter((m): m is RegExpExecArray => m !== null).map((m) => Number(m[1]));
    expect(Math.max(...levels)).toBeGreaterThan(Math.min(...levels));
    const dense = (level: number): boolean => layers.some((layer) => layer.id === `traffic-dense-o${level}@r34`);
    expect(dense(Math.max(...levels))).toBe(true);
    expect(dense(Math.min(...levels))).toBe(false);
  });
});
