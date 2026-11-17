import { buildOfflineStyle, toFileUrl } from '../../example/src/spikes/offlineStyle';

const base = { packsDir: 'file:///var/mobile/Documents/packs/', pmtilesFile: 'istanbul-kadikoy.pmtiles', theme: 'light' as const, lang: 'tr' };

describe('toFileUrl', () => {
  it('leaves file urls alone and adds the scheme to plain paths', () => {
    expect(toFileUrl('file:///a/b')).toBe('file:///a/b');
    expect(toFileUrl('/a/b')).toBe('file:///a/b');
  });

  it('encodes spaces in plain paths but never double encodes urls', () => {
    expect(toFileUrl('/a b/c')).toBe('file:///a%20b/c');
    expect(toFileUrl('file:///a%20b/c')).toBe('file:///a%20b/c');
  });
});

describe('buildOfflineStyle', () => {
  it('points the vector source at the local pmtiles file once', () => {
    const style = buildOfflineStyle(base);
    expect(style.sources.protomaps).toMatchObject({ type: 'vector', url: 'pmtiles://file:///var/mobile/Documents/packs/istanbul-kadikoy.pmtiles' });
    expect(JSON.stringify(style)).not.toContain('file://file://');
  });

  it('uses local glyphs and sprites only', () => {
    const style = buildOfflineStyle(base);
    expect(style.glyphs).toBe('file:///var/mobile/Documents/packs/fonts/{fontstack}/{range}.pbf');
    expect(style.sprite).toBe('file:///var/mobile/Documents/packs/sprites/v4/light');
    expect(JSON.stringify(style)).not.toMatch(/https?:/);
  });

  it('switches sprite and colors with the theme', () => {
    const light = buildOfflineStyle(base);
    const dark = buildOfflineStyle({ ...base, theme: 'dark' });
    expect(dark.sprite).toBe('file:///var/mobile/Documents/packs/sprites/v4/dark');
    expect(JSON.stringify(dark.layers[0])).not.toBe(JSON.stringify(light.layers[0]));
  });

  it('uses the requested label language', () => {
    expect(JSON.stringify(buildOfflineStyle(base).layers)).toContain('name:tr');
    expect(JSON.stringify(buildOfflineStyle({ ...base, lang: 'ar' }).layers)).toContain('name:ar');
  });

  it('keeps the original font names by default and can use space free names', () => {
    const original = buildOfflineStyle(base);
    expect(JSON.stringify(original.layers)).toContain('Noto Sans Regular');
    expect(original.glyphs).toContain('/fonts/{fontstack}');
    const compact = buildOfflineStyle({ ...base, fontNames: 'compact' });
    expect(JSON.stringify(compact.layers)).toContain('NotoSansRegular');
    expect(JSON.stringify(compact.layers)).not.toContain('Noto Sans');
    expect(compact.glyphs).toBe('file:///var/mobile/Documents/packs/fonts-compact/{fontstack}/{range}.pbf');
  });

  it('is plain json with unique layer ids that all use the one source', () => {
    const style = buildOfflineStyle(base);
    expect(JSON.parse(JSON.stringify(style))).toEqual(style);
    const ids = style.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    style.layers.filter((l) => l.type !== 'background').forEach((l) => expect(l.source).toBe('protomaps'));
    expect(style.version).toBe(8);
  });

  it('only references font stacks that are shipped in the packs', () => {
    for (const fontNames of ['original', 'compact'] as const) {
      const text = JSON.stringify(buildOfflineStyle({ ...base, fontNames }).layers);
      const names = new Set(text.match(/Noto ?Sans[A-Za-z ]*?(Regular|Medium|Italic)( v\d)?/g));
      const shipped = fontNames === 'compact' ? ['NotoSansRegular', 'NotoSansMedium', 'NotoSansItalic'] : ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
      expect([...names].sort()).toEqual(shipped.sort());
    }
  });

  it('carries the OpenStreetMap credit on the source', () => {
    expect(JSON.stringify(buildOfflineStyle(base).sources.protomaps)).toContain('OpenStreetMap');
  });

  it('accepts a plain path for the packs folder', () => {
    expect(buildOfflineStyle({ ...base, packsDir: '/data/packs' }).glyphs).toBe('file:///data/packs/fonts/{fontstack}/{range}.pbf');
  });
});
