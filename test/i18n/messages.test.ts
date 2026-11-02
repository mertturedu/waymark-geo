import { LANGS, MESSAGE_KEYS, isRtl, t, tryMessage } from '../../src/core/i18n/messages';
import { STATES } from '../../src/core/packs/machine';
import { PACK_ERROR_CODES } from '../../src/core/packs/types';

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe('SDK messages', () => {
  it('has six languages', () => {
    expect([...LANGS]).toEqual(['tr', 'en', 'de', 'ar', 'ru', 'el']);
  });

  it.each(LANGS.map((l) => [l]))('has every key in %s, no empty text and no stray spaces (K5.5)', (lang) => {
    for (const key of MESSAGE_KEYS) {
      const text = tryMessage(lang, key);
      expect(text).toBeDefined();
      expect((text ?? '').length).toBeGreaterThan(0);
      expect(text).toBe((text ?? '').trim());
    }
  });

  it('has no extra keys in any language', () => {
    for (const lang of LANGS) expect(tryMessage(lang, 'zzz.unknown' as never)).toBeUndefined();
  });

  it('uses the same placeholders in every language', () => {
    for (const key of MESSAGE_KEYS) {
      const reference = placeholders(t('tr', key));
      for (const lang of LANGS) expect({ key, lang, found: placeholders(t(lang, key)) }).toEqual({ key, lang, found: reference });
    }
  });

  it('has a status text for every region state and an error text for every error code', () => {
    for (const state of STATES) expect(MESSAGE_KEYS).toContain(`status.${state}`);
    for (const code of PACK_ERROR_CODES) expect(MESSAGE_KEYS).toContain(`error.${code}`);
  });

  it('fills placeholders and keeps unknown ones visible', () => {
    expect(t('en', 'suggest.region', { name: 'İzmir' })).toContain('İzmir');
    expect(t('tr', 'suggest.region', {})).toContain('{name}');
    expect(t('tr', 'progress', { done: 3, total: 40 })).toContain('3');
    expect(t('tr', 'progress', { done: 3, total: 40 })).toContain('40');
    expect(t('tr', 'suggest.region', { name: '$&' })).toContain('$&');
  });

  it('reads a language tag by its first two letters and falls back to Turkish', () => {
    expect(t('de-DE', 'sheet.close')).toBe(t('de', 'sheet.close'));
    expect(t('EN', 'sheet.close')).toBe(t('en', 'sheet.close'));
    expect(t('ru_RU', 'sheet.close')).toBe(t('ru', 'sheet.close'));
    expect(t('xx', 'sheet.close')).toBe(t('tr', 'sheet.close'));
    expect(t('', 'sheet.close')).toBe(t('tr', 'sheet.close'));
    expect(t(undefined as never, 'sheet.close')).toBe(t('tr', 'sheet.close'));
  });

  it('writes the languages with their own script', () => {
    expect(t('ar', 'sheet.title')).toMatch(/[؀-ۿ]/);
    expect(t('ru', 'sheet.title')).toMatch(/[Ѐ-ӿ]/);
    expect(t('el', 'sheet.title')).toMatch(/[Ͱ-Ͽ]/);
    expect(t('tr', 'sheet.title')).toMatch(/[a-zçğıöşü]/);
  });

  it('says right to left for Arabic only', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('ar-SA')).toBe(true);
    expect(isRtl('AR')).toBe(true);
    for (const lang of ['tr', 'en', 'de', 'ru', 'el', 'xx', '']) expect(isRtl(lang)).toBe(false);
  });

  it('names the OpenStreetMap contributors in the attribution of every language', () => {
    for (const lang of LANGS) expect(t(lang, 'attribution.text')).toContain('OpenStreetMap');
  });
});
