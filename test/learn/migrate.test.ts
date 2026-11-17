import { CURRENT_VERSION, migrate } from '../../src/core/learn/migrate';

const v1 = {
  v: 1, key: '34|kadikoy|caferaga|moda~cadde|40', region: '34', text: 'Moda Caddesi No:40, Caferağa Mah., Kadıköy/İstanbul',
  confirmations: [{ source: 'pin', lng: 29.02, lat: 40.98, at: 1_700_000_000 }, { source: 'delivery', lng: 29.0201, lat: 40.9801, accuracyM: 8, at: 1_700_000_100 }],
};

const v0 = {
  v: 0, key: '34|kadikoy|caferaga|moda~cadde|40', region: '34', label: 'Moda Caddesi No:40, Caferağa Mah., Kadıköy/İstanbul',
  points: [{ lng: 29.02, lat: 40.98, kind: 'pin', t: 1_700_000_000 }, { lng: 29.0201, lat: 40.9801, kind: 'gps', acc: 8, t: 1_700_000_100 }],
};

describe('migrate', () => {
  it('passes a current record through unchanged', () => {
    expect(migrate(JSON.stringify(v1))).toEqual({ record: v1 });
  });

  it('upgrades the pre-release format', () => {
    expect(migrate(JSON.stringify(v0))).toEqual({ record: v1 });
  });

  it('is idempotent', () => {
    const once = migrate(JSON.stringify(v0));
    expect('record' in once && migrate(JSON.stringify(once.record))).toEqual(once);
  });

  it('leaves a record written by a newer version alone', () => {
    expect(migrate(JSON.stringify({ ...v1, v: CURRENT_VERSION + 1, extra: true }))).toEqual({ skipped: 'newer' });
  });

  it.each([
    ['not json', '{oops'],
    ['not an object', '[1,2]'],
    ['null', 'null'],
    ['no version', JSON.stringify({ ...v1, v: undefined })],
    ['version is text', JSON.stringify({ ...v1, v: '1' })],
    ['negative version', JSON.stringify({ ...v1, v: -1 })],
    ['no key', JSON.stringify({ ...v1, key: undefined })],
    ['key is a number', JSON.stringify({ ...v1, key: 5 })],
    ['no region', JSON.stringify({ ...v1, region: undefined })],
    ['no text', JSON.stringify({ ...v1, text: undefined })],
    ['confirmations is not a list', JSON.stringify({ ...v1, confirmations: 'x' })],
    ['confirmations is empty', JSON.stringify({ ...v1, confirmations: [] })],
    ['unknown source', JSON.stringify({ ...v1, confirmations: [{ source: 'sms', lng: 29, lat: 41, at: 1 }] })],
    ['longitude is text', JSON.stringify({ ...v1, confirmations: [{ source: 'pin', lng: '29', lat: 41, at: 1 }] })],
    ['latitude is missing', JSON.stringify({ ...v1, confirmations: [{ source: 'pin', lng: 29, at: 1 }] })],
    ['time is missing', JSON.stringify({ ...v1, confirmations: [{ source: 'pin', lng: 29, lat: 41 }] })],
    ['accuracy is text', JSON.stringify({ ...v1, confirmations: [{ source: 'pin', lng: 29, lat: 41, at: 1, accuracyM: 'x' }] })],
    ['v0 without points', JSON.stringify({ ...v0, points: undefined })],
    ['v0 with an unknown kind', JSON.stringify({ ...v0, points: [{ lng: 29, lat: 41, kind: 'sms', t: 1 }] })],
  ])('calls %s damaged', (_name, raw) => {
    expect(migrate(raw)).toEqual({ skipped: 'damaged' });
  });

  it('drops fields the schema does not allow when it rebuilds a record', () => {
    const result = migrate(JSON.stringify({ ...v0, phone: '0555', points: [{ ...v0.points[0], name: 'Ahmet' }] }));
    expect(result).toEqual({ record: { ...v1, confirmations: [v1.confirmations[0]] } });
  });

  it('keeps an optional accuracy only when it is a number', () => {
    const result = migrate(JSON.stringify(v1));
    expect('record' in result && result.record.confirmations[0]).not.toHaveProperty('accuracyM');
  });
});
