import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGE_KEYS } from '../../src/core/i18n/messages';
import { BRAND_ICONS, BUSINESS_ICONS, SDF_ICONS, SERVICE_ICONS } from '../../src/native/map/style';

const root = join(__dirname, '../../src/native');

describe('map icons', () => {
  const names = [...Object.keys(SERVICE_ICONS), ...BUSINESS_ICONS];

  const pictures = [...names, ...BRAND_ICONS];

  it('has a picture file for every category the style can ask for', () => {
    for (const name of pictures) {
      const file = join(root, 'map', 'icons', `${name}.png`);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeGreaterThan(500);
      expect(statSync(file).size).toBeLessThan(20_000);
      expect(readFileSync(file).subarray(1, 4).toString()).toBe('PNG');
    }
  });

  it('registers exactly those pictures for the map', () => {
    const text = readFileSync(join(root, 'platform', 'icon-images.ts'), 'utf8');
    const registered = [...text.matchAll(/'(geo-[a-z0-9-]+)':/g)].map((m) => m[1]).sort();
    expect(registered).toEqual([...pictures, ...SDF_ICONS].sort());
  });

  it('ships every single-colour icon the style asks for as a small distance field marked for tinting', () => {
    const text = readFileSync(join(root, 'platform', 'icon-images.ts'), 'utf8');
    for (const name of SDF_ICONS) {
      const file = join(root, 'map', 'icons', `${name}.png`);
      expect(existsSync(file)).toBe(true);
      expect(statSync(file).size).toBeLessThan(4_000);
      expect(text).toMatch(new RegExp(`'${name}': \\{ source: [a-z_]+, sdf: true \\}`));
    }
  });

  it('explains every category in the legend in all languages', () => {
    for (const name of names) expect(MESSAGE_KEYS).toContain(`legend.${name.replace('geo-', '')}`);
    expect(MESSAGE_KEYS).toContain('legend.brands');
    expect(MESSAGE_KEYS).toContain('legend.title');
    expect(MESSAGE_KEYS).toContain('legend.button');
  });

  it('lists the same categories in the legend component', () => {
    const text = readFileSync(join(root, 'react', 'MapLegend.tsx'), 'utf8');
    const shown = [...text.matchAll(/icon: '(geo-[a-z0-9-]+)'/g)].map((m) => m[1]).sort();
    expect(shown).toEqual([...names, 'geo-brand-a101'].sort());
  });
});
