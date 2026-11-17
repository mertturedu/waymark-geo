import { floorDoor, hasPersonalData, parseRecord, readRecords } from '../../pipeline/real/records';

const base = { v: 1, src: 'h1', week: 2800, region: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Bahariye Caddesi', houseNumber: '10', coordSource: 'gps', gps: { lng: 29, lat: 41, accuracyM: 10 } };
const line = (over: Record<string, unknown> = {}): string => JSON.stringify({ ...base, ...over });

describe('parseRecord', () => {
  it('accepts a complete delivery record', () => {
    expect(parseRecord(line())).toMatchObject({ ok: true, record: { region: '34', gps: { accuracyM: 10 } } });
  });

  it.each([
    ['not json', 'invalid-json'],
    ['[1]', 'invalid-json'],
  ])('rejects %s', (text, reason) => {
    expect(parseRecord(text)).toEqual({ ok: false, reason });
  });

  it('rejects any field outside the whitelist, so names and phones cannot ride along', () => {
    expect(parseRecord(line({ courierName: 'Ali' }))).toEqual({ ok: false, reason: 'unknown-field' });
    expect(parseRecord(line({ phone: '05321234567' }))).toEqual({ ok: false, reason: 'unknown-field' });
  });

  it('rejects personal data inside the text fields', () => {
    expect(parseRecord(line({ street: 'Bahariye 0532 123 45 67' }))).toEqual({ ok: false, reason: 'personal-data' });
    expect(parseRecord(line({ door: 'ali@example.com' }))).toEqual({ ok: false, reason: 'personal-data' });
    expect(parseRecord(line({ block: '12345678901' }))).toEqual({ ok: false, reason: 'personal-data' });
  });

  it('requires a district, a house number, a source id and a street or neighbourhood', () => {
    expect(parseRecord(line({ district: undefined }))).toEqual({ ok: false, reason: 'missing-field' });
    expect(parseRecord(line({ houseNumber: '' }))).toEqual({ ok: false, reason: 'missing-field' });
    expect(parseRecord(line({ src: undefined }))).toEqual({ ok: false, reason: 'missing-field' });
    expect(parseRecord(line({ street: undefined, neighbourhood: undefined }))).toEqual({ ok: false, reason: 'missing-field' });
  });

  it('rejects out-of-range values', () => {
    expect(parseRecord(line({ region: '3' }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ week: -1 }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ coordSource: 'magic' }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ gps: { lng: 0, lat: 0, accuracyM: 5 } }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ gps: { lng: 29, lat: 41, accuracyM: 0 } }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ street: 'x'.repeat(200) }))).toEqual({ ok: false, reason: 'bad-value' });
  });

  it('drops records with no point worth learning from', () => {
    expect(parseRecord(line({ gps: { lng: 29, lat: 41, accuracyM: 80 } }))).toEqual({ ok: false, reason: 'no-usable-point' });
    expect(parseRecord(line({ coordSource: 'geocoder' }))).toEqual({ ok: false, reason: 'no-usable-point' });
    expect(parseRecord(line({ coordSource: 'unknown', gps: undefined, pin: { lng: 29, lat: 41 } }))).toEqual({ ok: false, reason: 'no-usable-point' });
  });

  it('accepts a pin, a stop point and an entrance', () => {
    const r = parseRecord(line({ coordSource: 'pin', gps: undefined, pin: { lng: 29, lat: 41 }, stop: { lng: 29.0001, lat: 41 }, entrance: { lng: 29, lat: 41.0001 } }));
    expect(r).toMatchObject({ ok: true, record: { pin: { lng: 29 }, stop: { lng: 29.0001 }, entrance: { lat: 41.0001 } } });
  });
});

describe('trace and courier floor', () => {
  const point = (t: number, extra: Record<string, unknown> = {}) => ({ lng: 29, lat: 41, accuracyM: 8, t, ...extra });

  it('accepts a trace of at most thirty points with seconds before the delivery', () => {
    const r = parseRecord(line({ trace: [point(90, { speed: 1.2 }), point(87, { speed: null }), point(0)], courierFloor: '3' }));
    expect(r).toMatchObject({ ok: true, record: { courierFloor: '3', trace: [{ t: 90, speed: 1.2 }, { t: 87, speed: null }, { t: 0 }] } });
    expect(parseRecord(line({ trace: Array.from({ length: 31 }, (_, i) => point(i)) }))).toEqual({ ok: false, reason: 'bad-value' });
  });

  it('refuses a trace that carries a clock time or any other shape', () => {
    expect(parseRecord(line({ trace: [point(1_794_300_000)] }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ trace: [point(-1)] }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ trace: [point(5, { accuracyM: 0 })] }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ trace: [point(5, { speed: 'fast' })] }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ trace: [{ lng: 0, lat: 0, accuracyM: 5, t: 1 }] }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ trace: 'x' }))).toEqual({ ok: false, reason: 'bad-value' });
    expect(parseRecord(line({ trace: [{ ...point(5), device: 'a' }] }))).toMatchObject({ ok: true });
  });

  it('keeps a record that has only a trace as a point source', () => {
    expect(parseRecord(line({ coordSource: 'delivery', gps: undefined, trace: [point(9), point(6)] }))).toMatchObject({ ok: true });
    expect(parseRecord(line({ coordSource: 'delivery', gps: undefined, trace: [point(9)] }))).toEqual({ ok: false, reason: 'no-usable-point' });
  });

  it('prefers the floor the courier chose, drops a disagreement and a lower bound', () => {
    const read = (over: Record<string, unknown>) => floorDoor(JSON.parse(line({ door: '12', ...over })) as never);
    expect(read({ courierFloor: '3' })).toEqual({ floor: 3, door: 12 });
    expect(read({ courierFloor: 'Zemin', floor: '2' })).toBeNull();
    expect(read({ courierFloor: '4', floor: '4' })).toEqual({ floor: 4, door: 12 });
    expect(read({ courierFloor: '8+' })).toBeNull();
    expect(read({ courierFloor: '8+', floor: '9' })).toEqual({ floor: 9, door: 12 });
    expect(read({ courierFloor: 'Bodrum' })).toEqual({ floor: -1, door: 12 });
  });
});

describe('readRecords', () => {
  it('counts what it throws away', () => {
    const { records, rejected } = readRecords([line(), '', line({ extra: 1 }), 'nope', line({ district: 'Ali 05321234567' })]);
    expect(records).toHaveLength(1);
    expect(rejected).toMatchObject({ 'unknown-field': 1, 'invalid-json': 1, 'personal-data': 1 });
  });
});

describe('floorDoor and hasPersonalData', () => {
  it('reads written floors and doors', () => {
    expect(floorDoor(JSON.parse(line({ floor: 'Zemin', door: 'D:4' })) as never)).toEqual({ floor: 0, door: 4 });
    expect(floorDoor(JSON.parse(line({ floor: 'Bodrum', door: '2' })) as never)).toEqual({ floor: -1, door: 2 });
    expect(floorDoor(JSON.parse(line({ floor: '3' })) as never)).toBeNull();
  });

  it('does not flag ordinary address text', () => {
    expect(hasPersonalData('Bahariye Caddesi No: 10 Daire 4')).toBe(false);
    expect(hasPersonalData('+90 532 123 45 67')).toBe(true);
  });
});
