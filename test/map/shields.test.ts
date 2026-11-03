import { expression, latest } from '@maplibre/maplibre-gl-style-spec';
import { SHIELD_IMAGES, shieldImageExpression, shieldOf } from '../../src/native/map/shields';
import { buildStyle, type StyleInput } from '../../src/native/map/style';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('shieldOf', () => {
  it.each([
    ['D 100', 'state', 'D100'],
    ['D100', 'state', 'D100'],
    ['D.100', 'state', 'D100'],
    ['d-650', 'state', 'D650'],
    ['O-1', 'motorway', 'O-1'],
    ['O1', 'motorway', 'O-1'],
    ['O 52', 'motorway', 'O-52'],
    ['E 80', 'euro', 'E80'],
    ['E80', 'euro', 'E80'],
    ['E-90', 'euro', 'E90'],
    ['34-12', 'provincial', '34-12'],
    ['06-123', 'provincial', '06-123'],
  ])('%s is a %s shield written %s', (ref, kind, text) => {
    expect(shieldOf(ref)).toEqual({ kind, text });
  });

  it.each(['', '   ', 'Atatürk Caddesi', 'X 100', 'D', 'D 1234', 'O-1;E80', 'D100 D200 E5', '1234'])('draws no shield for "%s"', (ref) => {
    expect(shieldOf(ref)).toBeNull();
  });
});

describe('shield layer', () => {
  const input: StyleInput = { rootUrl: 'file:///root', baseDir: 'base-1', regions: [{ id: '34', tilesPath: 't.pmtiles' }], theme: 'light', lang: 'tr' };
  const kindOf = (ref: string): unknown => {
    const spec = (latest as unknown as Record<string, Record<string, unknown>>).layout_symbol!['icon-image'];
    const parsed = expression.createExpression(shieldImageExpression(), 'layers[0].layout.icon-image', spec as never);
    if (parsed.result !== 'success') throw new Error(JSON.stringify(parsed.value));
    return (parsed.value as { evaluate: (g: unknown, f: unknown) => unknown }).evaluate({ zoom: 14 }, { type: 'LineString', properties: { ref } });
  };

  it('picks the same image as shieldOf for every reference form', () => {
    for (const ref of ['D 100', 'D100', 'O-1', 'O1', 'E 80', 'E80', '34-12']) expect((kindOf(ref) as { name: string }).name).toBe(SHIELD_IMAGES[shieldOf(ref)!.kind]);
  });

  it('reads the ref property, fits the shield to the text and names images the app registers', () => {
    const layer = buildStyle(input).layers.find((l) => l.id === 'roads_shields@r34')!;
    expect(layer.layout).toMatchObject({ 'text-field': ['get', 'ref'], 'icon-text-fit': 'both', 'symbol-placement': 'line' });
    expect(JSON.stringify(layer.filter)).toContain('"ref"');
    expect(JSON.stringify(layer.filter)).not.toContain('shield_text');
    const registry = readFileSync(join(__dirname, '../../src/native/platform/shield-images.ts'), 'utf8');
    const icons = readFileSync(join(__dirname, '../../src/native/platform/icon-images.ts'), 'utf8');
    expect(icons).toContain('...SHIELD_ICON_IMAGES');
    for (const name of Object.values(SHIELD_IMAGES)) {
      expect(registry).toContain(`'${name}'`);
      expect(existsSync(join(__dirname, `../../src/native/map/icons/${name}.png`))).toBe(true);
    }
  });
});
