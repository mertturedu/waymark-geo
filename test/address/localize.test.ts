import { createSearch } from '../../src/core/address/search';
import { pickName } from '../../src/core/address/localize';
import { createLearning } from '../../src/core/learn/learning';
import { memoryStore as learnStore } from '../../src/core/learn/store';
import { builtPack, memoryStore, turkeyBorders } from './helpers/search-fixture';

describe('pickName', () => {
  it('takes the asked language, then English, then Turkish', () => {
    const names = { tr: 'Kadıköy', en: 'Kadikoy', ru: 'Кадыкёй' };
    expect(pickName(names, 'ru', 'x')).toBe('Кадыкёй');
    expect(pickName(names, 'de', 'x')).toBe('Kadikoy');
    expect(pickName({ tr: 'Moda' }, 'ar', 'x')).toBe('Moda');
    expect(pickName(names, 'tr', 'x')).toBe('Kadıköy');
  });
  it('gives the fallback when nothing is known', () => {
    expect(pickName(null, 'en', 'Moda')).toBe('Moda');
    expect(pickName({}, 'en', 'Moda')).toBe('Moda');
  });
});

describe('labels in other languages', () => {
  async function labelOf(language: string) {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store, borders: turkeyBorders() });
    const result = await search.resolve('Bahariye Caddesi 14', { language: language as never, hints: { city: 'İstanbul' } });
    await close();
    return result.status === 'resolved' ? result.best : null;
  }

  it('writes province and district names of the asked language', async () => {
    const ru = await labelOf('ru');
    expect(ru?.components).toMatchObject({ province: 'Стамбул', district: 'Кадыкёй' });
    expect(ru?.label).toContain('Кадыкёй');
  });

  it('falls back to English for a language without a name', async () => {
    const de = await labelOf('de');
    expect(de?.components.province).toBe('İstanbul');
  });

  it('keeps Turkish for Turkish and leaves the street as it is', async () => {
    const tr = await labelOf('tr');
    expect(tr?.components).toMatchObject({ province: 'İstanbul', district: 'Kadıköy', street: 'Bahariye Caddesi' });
  });

  it('uses the neighbourhood names the pack carries', async () => {
    const ru = await labelOf('ru');
    expect(typeof ru?.components.neighbourhood === 'string' || ru?.components.neighbourhood === undefined).toBe(true);
  });
});

describe('learning across languages', () => {
  it('finds a point confirmed on a Russian label when asked in Turkish', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const learning = await createLearning({ store: learnStore() });
    const search = createSearch({ store, borders: turkeyBorders(), layers: [learning.layer] });
    const russian = await search.resolve('Zeytin Sokak 3', { language: 'ru', hints: { city: 'İstanbul' } });
    const place = russian.status === 'resolved' || russian.status === 'ambiguous' ? russian.candidates[0] : undefined;
    expect(place?.components.district).toBe('Кадыкёй');
    const saved = await learning.confirm({ place: place as never, houseNumber: '3', point: [28.7, 40.7], source: 'pin' });
    expect(saved.ok).toBe(true);
    const turkish = await search.resolve('Zeytin Sokak 3', { language: 'tr', hints: { city: 'İstanbul' } });
    expect(turkish.status === 'resolved' && turkish.best).toMatchObject({ source: 'learned', coordinate: [28.7, 40.7] });
    await close();
  });
});

describe('localizeComponents with little to go on', () => {
  const ctx = (hoods: { name: string; names?: Record<string, string> }[], language = 'ru') => ({ language, region: { id: '34', hoods } }) as never;

  it('leaves Turkish components alone', async () => {
    const { localizeComponents } = await import('../../src/core/address/localize');
    const c = { province: 'İstanbul', district: 'Kadıköy' };
    expect(localizeComponents(ctx([], 'tr'), c)).toBe(c);
  });

  it('copes with components that name nothing', async () => {
    const { localizeComponents } = await import('../../src/core/address/localize');
    expect(localizeComponents(ctx([]), {})).toEqual({});
  });

  it('keeps a district that is not in the official list and a hood without translations', async () => {
    const { localizeComponents } = await import('../../src/core/address/localize');
    expect(localizeComponents(ctx([{ name: 'Moda' }]), { district: 'Hayalî İlçe', neighbourhood: 'Moda' })).toEqual({ district: 'Hayalî İlçe', neighbourhood: 'Moda' });
  });

  it('takes the neighbourhood name of the asked language when the pack has one', async () => {
    const { localizeComponents } = await import('../../src/core/address/localize');
    expect(localizeComponents(ctx([{ name: 'Moda', names: { ru: 'Мода' } }]), { neighbourhood: 'Moda' })).toEqual({ neighbourhood: 'Мода' });
  });

  it('keeps a neighbourhood the pack does not list', async () => {
    const { localizeComponents } = await import('../../src/core/address/localize');
    expect(localizeComponents(ctx([]), { neighbourhood: 'Bilinmeyen' })).toEqual({ neighbourhood: 'Bilinmeyen' });
  });
});

describe('namesOf', () => {
  it('reads the names of a neighbourhood and drops what is not text', async () => {
    const { namesOf } = await import('../../src/core/address/pack');
    expect(namesOf(JSON.stringify({ names: { ru: 'Мода', ar: 5, en: '' } }))).toEqual({ ru: 'Мода' });
  });
  it('gives nothing for empty, missing or broken extra data', async () => {
    const { namesOf } = await import('../../src/core/address/pack');
    expect(namesOf('{}')).toBeNull();
    expect(namesOf(JSON.stringify({ names: {} }))).toBeNull();
    expect(namesOf('bozuk')).toBeNull();
  });
});

describe('reverse in another language', () => {
  it('names province and district like resolve does and keeps the Turkish components for learning', async () => {
    const { store, close } = await memoryStore({ '34': await builtPack() });
    const search = createSearch({ store, borders: turkeyBorders() });
    const place = await search.reverse([28.59995, 40.7], { language: 'ru' });
    expect(place?.components).toMatchObject({ province: 'Стамбул', district: 'Кадыкёй' });
    expect(place?.label).toContain('Кадыкёй');
    expect(place?.local).toMatchObject({ province: 'İstanbul', district: 'Kadıköy' });
    const turkish = await search.reverse([28.59995, 40.7]);
    expect(turkish?.local).toBeUndefined();
    await close();
  });
});

describe('confirm with names too long to be kept', () => {
  it('refuses a point whose key would be dropped at the next start', async () => {
    const learning = await createLearning({ store: learnStore() });
    const place = { id: '34:l:1', label: 'x', components: { province: 'İstanbul', district: 'Kadıköy', street: 'A'.repeat(166), houseNumber: '3' }, coordinate: [28.6, 40.7] as [number, number], precision: 'street' as const, approximate: true, source: 'derived' as const, confidence: 0.5, region: '34' };
    expect(await learning.confirm({ place, point: [28.61, 40.71], source: 'pin' })).toEqual({ ok: false, reason: 'no-key' });
    expect(learning.stats().keys).toBe(0);
  });
});
