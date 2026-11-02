import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expression, latest, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import chains from '../../src/native/map/chains.json';
import { buildStyle, type StyleInput, type StyleLayer } from '../../src/native/map/style';
import { contrast, createGeoTheme, DEFAULT_THEME, hiddenTokens, ICON_GROUPS, mix, monogram, parseColor, readableInk, resolveMapLook } from '../../src/native/map/theme';

const ICONS = join(__dirname, '../../src/native/map/icons');
const regions = [{ id: '34', tilesPath: 'files/34/tiles.pmtiles', placesPath: 'files/34/places.pmtiles' }];
const input = (extra: Partial<StyleInput> = {}): StyleInput => ({ rootUrl: 'file:///data/yuksi-geo/', baseDir: 'files/base-1', regions, theme: 'light', lang: 'tr', ...extra });
const layer = (style: { layers: StyleLayer[] }, id: string) => style.layers.find((l) => l.id === id)!;

const evaluate = (value: unknown, kind: 'layout_symbol' | 'paint_symbol', key: string, zoom: number, properties: Record<string, unknown>): unknown => {
  const spec = (latest as unknown as Record<string, Record<string, unknown>>)[kind]![key];
  const parsed = expression.createExpression(value, `layers[0].${kind === 'layout_symbol' ? 'layout' : 'paint'}.${key}`, spec as never);
  if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
  return (parsed.value as { evaluate: (g: unknown, f: unknown) => unknown }).evaluate({ zoom }, { type: 'Point', properties });
};

const pngWidth = (name: string): number => readFileSync(join(ICONS, `${name}.png`)).readUInt32BE(16);

describe('theme model', () => {
  it('resolves both sides with a colour, emphasis and visibility for every group and a badge for every chain', () => {
    expect(DEFAULT_THEME.warnings).toEqual([]);
    for (const side of [DEFAULT_THEME.light, DEFAULT_THEME.dark]) {
      for (const group of ICON_GROUPS) expect(side.map.icons.groups[group]).toMatchObject({ color: expect.stringMatching(/^#[0-9A-F]{6}$/), visible: true });
      for (const chain of chains) {
        const resolved = side.map.brands.chains[chain.id]!;
        expect(resolved.group).toBe(chain.group);
        expect(contrast(resolved.fill, resolved.ink)).toBeGreaterThanOrEqual(3);
        expect([...resolved.text].length).toBeGreaterThan(0);
        expect([...resolved.text].length).toBeLessThanOrEqual(3);
      }
    }
  });

  it('merges a partial theme and lets the dark side change only what differs', () => {
    const theme = createGeoTheme({ colors: { accent: '#e0050f' }, map: { icons: { groups: { cargo: { color: '#123456', emphasis: 'strong' } } } }, dark: { colors: { accent: '#ff4d55' } } });
    expect(theme.warnings).toEqual([]);
    expect(theme.light.colors.accent).toBe('#E0050F');
    expect(theme.dark.colors.accent).toBe('#FF4D55');
    expect(theme.dark.map.icons.groups.cargo).toEqual({ color: '#123456', emphasis: 'strong', visible: true });
    expect(theme.light.colors.bg).toBe(DEFAULT_THEME.light.colors.bg);
    expect(theme.dark.colors.bg).toBe(DEFAULT_THEME.dark.colors.bg);
  });

  it('falls back and warns instead of failing on bad values', () => {
    const theme = createGeoTheme({
      version: 2 as never,
      colors: { accent: 'red', radius: 99 },
      map: { icons: { style: 'loud' as never, scale: 9, groups: { cargo: { color: '#12' }, unicorn: {} } as never }, brands: { mode: 'big' as never, ladder: { badgeFrom: 18, logoFrom: 16 }, chains: { migros: { fill: 'orange' }, nowhere: {} } } },
    });
    expect(theme.light.colors.accent).toBe(DEFAULT_THEME.light.colors.accent);
    expect(theme.light.colors.radius).toBe(40);
    expect(theme.light.map.icons.style).toBe('color');
    expect(theme.light.map.icons.scale).toBe(2);
    expect(theme.light.map.brands.mode).toBe('ladder');
    expect(theme.light.map.brands).toMatchObject({ badgeFrom: 18, logoFrom: 18 });
    expect(theme.light.map.brands.chains.migros!.fill).toBe(DEFAULT_THEME.light.map.brands.chains.migros!.fill);
    for (const path of ['version', 'colors.accent', 'colors.radius', 'map.icons.style', 'map.icons.scale', 'map.icons.groups.cargo.color', 'map.icons.groups.unicorn', 'map.brands.mode', 'map.brands.ladder', 'map.brands.chains.migros.fill', 'map.brands.chains.nowhere']) {
      expect(theme.warnings.some((line) => line.startsWith(path))).toBe(true);
    }
    expect(createGeoTheme(null as never).warnings).toEqual([]);
  });

  it('keeps badge letters readable and short', () => {
    expect(readableInk('#FFD500', '#FFFFFF')).toBe('#151515');
    expect(readableInk('#E2001A', '#FFFFFF')).toBe('#FFFFFF');
    const theme = createGeoTheme({ map: { brands: { chains: { sok: { ink: '#FFEE00' }, migros: { text: 'Mg' } } } } });
    expect(theme.light.map.brands.chains.sok!.ink).toBe('#151515');
    expect(theme.light.map.brands.chains.migros!.text).toBe('Mg');
    expect(monogram('MİGROS')).toBe('M');
    expect(monogram('BİM')).toBe('BİM');
    expect(monogram('A101')).toBe('A');
    expect(parseColor('#abc')).toBe('#AABBCC');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('turns hidden groups, landmarks, chains and a hidden brand mode into hide tokens', () => {
    const look = resolveMapLook(DEFAULT_THEME.light.map, { icons: { groups: { food: { visible: false }, landmark: { visible: false } } }, brands: { mode: 'hidden', chains: { aras: { visible: false } } } });
    expect(hiddenTokens(look).sort()).toEqual(['brands', 'chain:aras', 'group:food', 'landmarks']);
    expect(hiddenTokens(DEFAULT_THEME.light.map)).toEqual([]);
  });

  it('does not change the theme it starts from', () => {
    const before = JSON.stringify(DEFAULT_THEME);
    resolveMapLook(DEFAULT_THEME.light.map, { icons: { scale: 0.7, groups: { cargo: { color: '#000000' } } }, brands: { chains: { bim: { fill: '#000000' } } } });
    expect(JSON.stringify(DEFAULT_THEME)).toBe(before);
  });
});

describe('chain stores by zoom', () => {
  const style = buildStyle(input());
  const sdf = layer(style, 'ov-brand@ov34');
  const logo = layer(style, 'ov-brand@ov34:logo');
  const migros = { b: 'migros', g: 'market', c: 90 };

  it('shows the category icon far out, a badge in the middle and the logo only close up', () => {
    expect(sdf.maxzoom).toBe(17.5);
    expect(logo.minzoom).toBe(17.5);
    expect(evaluate(sdf.layout!['icon-image'], 'layout_symbol', 'icon-image', 15, migros)).toMatchObject({ name: 'geo-sdf-market' });
    expect(evaluate(sdf.layout!['icon-image'], 'layout_symbol', 'icon-image', 16.5, migros)).toMatchObject({ name: 'geo-sdf-badge' });
    expect(String(evaluate(sdf.layout!['text-field'], 'layout_symbol', 'text-field', 15, migros))).toBe('');
    expect(String(evaluate(sdf.layout!['text-field'], 'layout_symbol', 'text-field', 16.5, migros))).toBe('M');
  });

  it('paints the far icon in the group colour and the badge in the chain colour', () => {
    const colour = (zoom: number) => (evaluate(sdf.paint!['icon-color'], 'paint_symbol', 'icon-color', zoom, migros) as { toString(): string }).toString();
    expect(colour(15)).not.toBe(colour(16.5));
    const custom = buildStyle(input({ look: resolveMapLook(DEFAULT_THEME.light.map, { icons: { groups: { market: { color: '#00FF00' } } }, brands: { chains: { migros: { fill: '#0000FF' } } } }) }));
    const paint = layer(custom, 'ov-brand@ov34').paint!['icon-color'];
    expect(evaluate(paint, 'paint_symbol', 'icon-color', 15, migros)).toMatchObject({ r: 0, g: 1, b: 0 });
    expect(evaluate(paint, 'paint_symbol', 'icon-color', 16.5, migros)).toMatchObject({ r: 0, g: 0, b: 1 });
  });

  it('keeps every icon at most 20 pt wide up to zoom 16 and every logo at most 46 pt', () => {
    const widest = (zoom: number): number => {
      let most = 0;
      for (const l of style.layers.filter((x) => /^(ov-|service@)/.test(x.id) && x.layout?.['icon-image'] && (x.maxzoom ?? 99) > zoom && (x.minzoom ?? 0) <= zoom)) {
        for (const chain of chains) {
          for (const g of ICON_GROUPS) {
            const props = { b: chain.id, g, kind: 'pharmacy', c: 50, min_zoom: 0 };
            const image = evaluate(l.layout!['icon-image'], 'layout_symbol', 'icon-image', zoom, props) as { name: string } | string;
            const name = typeof image === 'string' ? image : image.name;
            const size = evaluate(l.layout!['icon-size'], 'layout_symbol', 'icon-size', zoom, props) as number;
            const inner = name.startsWith('geo-sdf-') ? pngWidth(name) - 16 : pngWidth(name);
            most = Math.max(most, inner * size);
          }
        }
      }
      return most;
    };
    for (const zoom of [14, 15, 15.9, 16]) expect(widest(zoom)).toBeLessThanOrEqual(20);
    for (const zoom of [17.5, 18, 19, 20]) expect(widest(zoom)).toBeLessThanOrEqual(46.5);
  });

  it('offers category only, badge only, the old logos and no chains at all', () => {
    const of = (mode: 'category' | 'badge' | 'logo' | 'hidden') => buildStyle(input({ look: resolveMapLook(DEFAULT_THEME.light.map, { brands: { mode } }) })).layers.filter((l) => l.id.startsWith('ov-brand@'));
    expect(of('category').map((l) => l.id)).toEqual(['ov-brand@ov34']);
    expect(JSON.stringify(of('category')[0]!.layout!['icon-image'])).not.toContain('badge');
    expect(of('badge').map((l) => [l.id, l.maxzoom])).toEqual([['ov-brand@ov34', undefined]]);
    expect(of('logo').map((l) => [l.id, l.minzoom])).toEqual([['ov-brand@ov34:logo', undefined]]);
    expect(of('hidden').every((l) => l.layout?.visibility === 'none')).toBe(true);
    const rounded = buildStyle(input({ look: resolveMapLook(DEFAULT_THEME.light.map, { brands: { shape: 'rounded', ladder: { badgeFrom: 15, logoFrom: 18 } } }) }));
    expect(JSON.stringify(layer(rounded, 'ov-brand@ov34').layout!['icon-image'])).toContain('"geo-sdf-badge-rounded"');
    expect(layer(rounded, 'ov-brand@ov34:logo').minzoom).toBe(18);
  });
});

describe('icons from the theme', () => {
  it('draws the quiet groups only from zoom 16 and puts the strong groups first', () => {
    const icon = layer(buildStyle(input()), 'ov-icon@ov34');
    const filter = JSON.stringify(icon.filter);
    expect(filter).toContain('["literal",["food","shop"]]');
    expect(filter).toContain('[">=",["zoom"],16]');
    const order = (g: string) => evaluate(icon.layout!['symbol-sort-key'], 'layout_symbol', 'symbol-sort-key', 15, { g, c: 50 }) as number;
    expect(order('pharmacy')).toBeLessThan(order('market'));
    expect(order('market')).toBeLessThan(order('shop'));
  });

  it('greys the icons in muted style and paints them all in the accent in mono style', () => {
    const colour = (style: 'muted' | 'mono') => evaluate(layer(buildStyle(input({ accent: '#E0050F', look: resolveMapLook(DEFAULT_THEME.light.map, { icons: { style } }) })), 'ov-icon@ov34').paint!['icon-color'], 'paint_symbol', 'icon-color', 15, { g: 'market' }) as { r: number; g: number; b: number };
    const mono = colour('mono');
    expect([Math.round(mono.r * 255), Math.round(mono.g * 255), Math.round(mono.b * 255)]).toEqual([224, 5, 15]);
    const muted = colour('muted');
    expect(Math.abs(muted.r - muted.b)).toBeLessThan(0.15);
  });

  it('scales every icon with the theme', () => {
    const size = (scale: number) => evaluate(layer(buildStyle(input({ look: resolveMapLook(DEFAULT_THEME.light.map, { icons: { scale } }) })), 'ov-icon@ov34').layout!['icon-size'], 'layout_symbol', 'icon-size', 15, { g: 'market' }) as number;
    expect(size(1.5) / size(1)).toBeCloseTo(1.5, 5);
  });

  it('hides what the theme hides on top of what the app hides', () => {
    const look = resolveMapLook(DEFAULT_THEME.light.map, { icons: { groups: { food: { visible: false } } } });
    const style = buildStyle(input({ look, hide: ['chain:aras'] }));
    expect(JSON.stringify(layer(style, 'ov-icon@ov34').filter)).toContain('["literal",["food"]]');
    expect(JSON.stringify(layer(style, 'ov-brand@ov34').filter)).toContain('["literal",["aras"]]');
  });

  it('is the same style without a theme and with the default theme, and valid in every mode and side', () => {
    expect(JSON.stringify(buildStyle(input()))).toBe(JSON.stringify(buildStyle(input({ look: DEFAULT_THEME.light.map, accent: DEFAULT_THEME.light.colors.accent }))));
    for (const theme of ['light', 'dark'] as const) {
      for (const mode of ['ladder', 'badge', 'category', 'logo', 'hidden'] as const) {
        for (const style of ['color', 'muted', 'mono'] as const) {
          expect(validateStyleMin(buildStyle(input({ theme, look: resolveMapLook(DEFAULT_THEME[theme].map, { icons: { style }, brands: { mode } }) })) as never)).toEqual([]);
        }
      }
    }
  });

  it('builds the style quickly enough to rebuild on a theme change', () => {
    const look = resolveMapLook(DEFAULT_THEME.light.map, { icons: { style: 'muted' } });
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), tilesPath: `files/${i}/t.pmtiles`, placesPath: `files/${i}/p.pmtiles` }));
    buildStyle(input({ regions: many, look }));
    const started = performance.now();
    for (let i = 0; i < 5; i += 1) buildStyle(input({ regions: many, look }));
    expect((performance.now() - started) / 5).toBeLessThan(20);
  });
});
