import { buildStyle, hoodLabelLayer, ROAD_LETTER_SPACING, HOOD_LETTER_SPACING, withFont, type StyleInput, type StyleLayer } from '../../src/native/map/style';
import { DEFAULT_THEME } from '../../src/native/map/theme';

const regions = [{ id: '34', tilesPath: 'tiles-a.pmtiles', placesPath: 'places-a.pmtiles' }];
const input = (extra: Partial<StyleInput> = {}): StyleInput => ({ rootUrl: 'file:///root', baseDir: 'base-1', regions, theme: 'light', lang: 'tr', ...extra });
const layer = (style: { layers: StyleLayer[] }, id: string): StyleLayer => style.layers.find((l) => l.id === id) as StyleLayer;

describe('street names', () => {
  it('spaces the letters 0.08-0.12 em and starts the small streets earlier', () => {
    const style = buildStyle(input());
    for (const id of ['roads_labels_minor@r34', 'roads_labels_major@r34']) {
      const spacing = layer(style, id).layout?.['text-letter-spacing'] as number;
      expect(spacing).toBe(ROAD_LETTER_SPACING);
      expect(spacing).toBeGreaterThanOrEqual(0.08);
      expect(spacing).toBeLessThanOrEqual(0.12);
    }
    expect(layer(style, 'roads_labels_minor@r34').minzoom).toBeLessThan(15);
    expect(layer(style, 'roads_labels_minor@base').minzoom).toBeLessThan(15);
  });

  it('keeps repeats apart and uses a grey that is lighter than the place names', () => {
    const style = buildStyle(input());
    expect(layer(style, 'roads_labels_minor@r34').layout).toMatchObject({ 'symbol-spacing': expect.any(Number), 'text-padding': expect.any(Number) });
    expect(layer(style, 'roads_labels_minor@r34').paint?.['text-color']).toBe('#6A7080');
  });
});

describe('place names', () => {
  const style = (theme: 'light' | 'dark', lang = 'tr') => buildStyle(input({ theme, lang }));
  const badge = (theme: 'light' | 'dark') => layer(style(theme), 'ov-icon@ov34');

  it('wraps at 7 em or less in every name layer', () => {
    for (const l of style('light').layers) {
      const width = l.layout?.['text-max-width'];
      if (typeof width === 'number' && l.id.includes('@ov')) expect(width).toBeLessThanOrEqual(7);
    }
    expect(badge('light').layout?.['text-max-width']).toBe(6);
  });

  it('colours the name from the group colour and differently on the dark map', () => {
    const light = JSON.stringify(badge('light').paint?.['text-color']);
    const dark = JSON.stringify(badge('dark').paint?.['text-color']);
    expect(light).toContain('match');
    expect(light).toContain('"var","grp"');
    expect(light).not.toBe(dark);
    expect(badge('light').paint?.['text-halo-color']).toBe('#FFFFFF');
  });

  it('prefers the shortened name in Turkish only', () => {
    expect(badge('light').layout?.['text-field']).toEqual(['coalesce', ['get', 'ns'], ['get', 'name:tr'], ['get', 'name']]);
    expect(JSON.stringify(layer(style('light', 'en'), 'ov-icon@ov34').layout?.['text-field'])).not.toContain('"ns"');
  });

  it('does not use the shortened name on service badges', () => {
    expect(JSON.stringify(layer(style('light'), 'service@r34').layout?.['text-field'])).not.toContain('"ns"');
  });
});

describe('neighbourhood names', () => {
  it('are grey, spaced and written in Turkish capitals from the data', () => {
    const light = hoodLabelLayer('light');
    expect(light.layout['text-field']).toEqual(['get', 'label']);
    expect(light.layout['text-letter-spacing']).toBe(HOOD_LETTER_SPACING);
    expect(light.layout['text-letter-spacing']).toBeGreaterThanOrEqual(0.08);
    expect(light.layout['text-transform']).toBeUndefined();
    expect(light.paint['text-color']).toBe('#6A7080');
    expect(hoodLabelLayer('dark').paint['text-color']).not.toBe(light.paint['text-color']);
  });

  it('use the district and province sizes as the larger steps', () => {
    const sizes = (hoodLabelLayer('light').layout['text-size'] as unknown[]);
    expect(sizes.slice(-1)[0]).toBeLessThan(15);
  });
});

describe('font option', () => {
  it('leaves the default untouched', () => {
    expect(JSON.stringify(buildStyle(input()))).not.toContain('Inter');
    expect(JSON.stringify(buildStyle(input({ font: 'noto' })))).not.toContain('Inter');
  });

  it('uses one Inter stack in every text layer, because the glyph files are plain files and cannot join two fonts', () => {
    const style = buildStyle(input({ font: 'inter' }));
    const stacks = (value: unknown): string[][] => (Array.isArray(value) ? (value.every((v) => typeof v === 'string' && /^(Inter|NotoSans)/.test(v)) && value.length > 0 ? [value as string[]] : value.flatMap(stacks)) : []);
    const all = style.layers.flatMap((l) => stacks(l.layout?.['text-font']));
    expect(all.length).toBeGreaterThan(10);
    expect(JSON.stringify(style)).not.toMatch(/"NotoSans(Regular|Medium|Italic)"(?!\])/);
    for (const stack of all) {
      expect(stack[0]).toMatch(/^Inter(Regular|Medium|Italic)$/);
      expect(stack).toHaveLength(1);
    }
  });

  it('does not change a layer without a font and is not applied twice', () => {
    const plain: StyleLayer = { id: 'x', type: 'fill' };
    expect(withFont([plain], 'inter')).toEqual([plain]);
    const once = withFont([{ id: 't', type: 'symbol', layout: { 'text-font': ['NotoSansMedium'] } }], 'inter');
    expect(once[0]?.layout?.['text-font']).toEqual(['InterMedium']);
    expect(withFont(once, 'noto')).toEqual(once);
  });

  it('draws the hood names in the chosen font', () => {
    expect(hoodLabelLayer('light', 'inter').layout['text-font']).toEqual(['InterMedium']);
  });

  it('works with the default theme object', () => {
    expect(DEFAULT_THEME.light.map).toBeDefined();
  });
});
