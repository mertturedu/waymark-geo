import { lineFromDoors } from '../../pipeline/build/address-pack';
import { streetSid } from '../../pipeline/build/sid';

const door = (lon: number, lat: number) => ({ lon, lat });

describe('lineFromDoors', () => {
  it('doğrusal dizilen kapılardan iki uçlu çizgi çıkarır', () => {
    const points = [0, 1, 2, 3, 4].map((i) => door(30 + i * 0.0004, 40 + i * 0.00001));
    const line = lineFromDoors(points);
    expect(line).toHaveLength(2);
    expect(line?.[0]?.[0]).toBeLessThan(line?.[1]?.[0] ?? 0);
  });

  it('az kapı, kısa uzunluk ya da dağınık nokta için çizgi çizmez', () => {
    expect(lineFromDoors([door(30, 40), door(30.001, 40)])).toBeNull();
    expect(lineFromDoors([0, 1, 2, 3].map((i) => door(30 + i * 0.00001, 40)))).toBeNull();
    expect(lineFromDoors([door(30, 40), door(30.001, 40.001), door(30, 40.001), door(30.001, 40), door(30.0005, 40.0005)])).toBeNull();
  });
});

describe('streetSid', () => {
  it('ad, tür ve ile bağlı kararlıdır', () => {
    expect(streetSid('34', 'ataturk', 'cadde')).toBe(streetSid('34', 'ataturk', 'cadde'));
    expect(streetSid('34', 'ataturk', 'cadde')).not.toBe(streetSid('34', 'ataturk', 'sokak'));
    expect(streetSid('34', 'ataturk', null)).toMatch(/^S34-[0-9a-f]{10}$/);
  });
});
