import { categoryOf } from '../../src/core/address/categories';
import { nameKey } from '../../src/core/text/fold';

describe('categoryOf', () => {
  it('finds the kinds and keeps the rest of the words', () => {
    expect(categoryOf('eczane fethiye')).toEqual({ kinds: ['pharmacy'], rest: 'fethiye' });
    expect(categoryOf('hastane')).toEqual({ kinds: ['hospital', 'clinic', 'health'], rest: '' });
    expect(categoryOf('fethiye')).toBeNull();
  });

  it.each([
    ['Apotheke', 'pharmacy'],
    ['Krankenhaus', 'hospital'],
    ['Tankstelle', 'fuel'],
    ['Moschee', 'mosque'],
    ['Rathaus', 'townhall'],
    ['аптека', 'pharmacy'],
    ['больница', 'hospital'],
    ['мечеть', 'mosque'],
    ['φαρμακείο', 'pharmacy'],
    ['νοσοκομείο', 'hospital'],
    ['τζαμί', 'mosque'],
    ['صيدلية', 'pharmacy'],
    ['مستشفى', 'hospital'],
    ['مسجد', 'mosque'],
  ])('knows %s in its own language', (word, kind) => {
    expect(categoryOf(`${nameKey(word)} kadikoy`)?.kinds).toContain(kind);
  });
});
