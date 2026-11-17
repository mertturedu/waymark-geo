import type { LngLat } from '../../src/core/geo/cells';
import { describeStep, directionsOf, formatDistance } from '../../src/core/route/directions';
import { LANGS, MESSAGE_KEYS, t } from '../../src/core/i18n/messages';

const COS = Math.cos((41 * Math.PI) / 180);
const at = (x: number, y: number): LngLat => [29 + x / (111195 * COS), 41 + y / 111195];
const line = (...pairs: [number, number][]): LngLat[] => {
  const out: LngLat[] = [];
  for (let i = 0; i + 1 < pairs.length; i++) {
    const [ax, ay] = pairs[i]!;
    const [bx, by] = pairs[i + 1]!;
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
    for (let k = 0; k < n; k++) out.push(at(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
  }
  out.push(at(...(pairs[pairs.length - 1] as [number, number])));
  return out;
};
const ROUTE = line([0, 0], [0, 200], [-300, 200]);

describe('formatDistance', () => {
  it.each([
    [4, 'tr', '10 m'], [34, 'tr', '30 m'], [96, 'tr', '100 m'], [120, 'tr', '100 m'], [180, 'en', '200 m'], [260, 'tr', '250 m'], [974, 'tr', '950 m'], [980, 'tr', '1 km'], [1000, 'en', '1 km'], [1240, 'tr', '1,2 km'], [1240, 'en', '1.2 km'], [1240, 'de', '1,2 km'], [3000, 'ru', '3 км'], [12500, 'el', '12,5 χλμ'], [1240, 'ar', '1.2 كم'],
  ])('%d m in %s is %s', (meters, lang, text) => {
    expect(formatDistance(meters, lang)).toBe(text);
  });

  it('never goes below zero', () => {
    expect(formatDistance(-5, 'tr')).toBe('10 m');
  });
});

describe('describeStep', () => {
  it('puts the distance in front of a turn and nothing in front of the start and the arrival', () => {
    const [start, left, arrive] = [
      { kind: 'start', at: at(0, 0), atM: 0, legM: 0 },
      { kind: 'left', at: at(0, 200), atM: 200, legM: 200 },
      { kind: 'arrive', at: at(-300, 200), atM: 500, legM: 300 },
    ].map((s) => describeStep(s as never, 'tr'));
    expect(start!.text).toBe('Yola çıkın');
    expect(left!.text).toBe('200 m sonra Sola dönün');
    expect(arrive!.text).toBe('Varış noktasına ulaştınız');
  });

  it('names the street after the turn and the roundabout exit', () => {
    expect(describeStep({ kind: 'right', at: at(0, 0), atM: 100, legM: 100, street: 'Moda Caddesi' }, 'tr').text).toBe('100 m sonra Sağa dönün: Moda Caddesi');
    expect(describeStep({ kind: 'right', at: at(0, 0), atM: 100, legM: 100, street: 'Moda Street' }, 'en').text).toBe('In 100 m, Turn right onto Moda Street');
    expect(describeStep({ kind: 'roundabout', at: at(0, 0), atM: 300, legM: 300, exit: 2 }, 'tr').text).toBe('300 m sonra Dönel kavşaktan 2. çıkıştan çıkın');
  });

  it('does not put a street on the arrival', () => {
    expect(describeStep({ kind: 'arrive', at: at(0, 0), atM: 10, legM: 10, street: 'X' }, 'tr').action).toBe('Varış noktasına ulaştınız');
  });

  it('has a sentence for every kind in all six languages, with no placeholder left', () => {
    const kinds = ['start', 'straight', 'slight-left', 'left', 'sharp-left', 'slight-right', 'right', 'sharp-right', 'uturn', 'roundabout', 'arrive'] as const;
    for (const lang of LANGS) {
      for (const kind of kinds) {
        const text = describeStep({ kind, at: at(0, 0), atM: 150, legM: 150, exit: 3, street: 'A' }, lang).text;
        expect(text).not.toMatch(/\{\w+\}/);
        expect(text.length).toBeGreaterThan(3);
      }
    }
  });
});

describe('directionsOf', () => {
  it('gives the steps of the route in the language asked for', async () => {
    const steps = await directionsOf(ROUTE, 'en');
    expect(steps.map((s) => s.kind)).toEqual(['start', 'left', 'arrive']);
    expect(steps[1]!.text).toMatch(/^In 200 m, Turn left$/);
  });

  it('asks for the street a little after each turn and not for the arrival', async () => {
    const asked: LngLat[] = [];
    const steps = await directionsOf(ROUTE, 'tr', async (point) => {
      asked.push(point);
      return point[0] < 29 ? 'Bağdat Caddesi' : 'Moda Caddesi';
    });
    expect(asked).toHaveLength(2);
    expect(steps[0]!.street).toBe('Moda Caddesi');
    expect(steps[1]!.street).toBe('Bağdat Caddesi');
    expect(steps[2]!.street).toBeUndefined();
    expect(steps[1]!.text).toBe('200 m sonra Sola dönün: Bağdat Caddesi');
  });

  it('carries on without a street when the lookup fails or finds nothing', async () => {
    const failing = await directionsOf(ROUTE, 'tr', async () => {
      throw new Error('no pack');
    });
    const empty = await directionsOf(ROUTE, 'tr', async () => null);
    expect(failing.every((s) => s.street === undefined)).toBe(true);
    expect(empty.map((s) => s.text)).toEqual(failing.map((s) => s.text));
  });
});

describe('messages added for navigation, cards and the scale', () => {
  it('has every key in every language and uses the same placeholders', () => {
    for (const key of MESSAGE_KEYS) {
      const holders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
      const reference = holders(t('tr', key));
      for (const lang of LANGS) {
        const text = t(lang, key);
        expect(text).not.toBe('');
        expect(holders(text)).toEqual(reference);
      }
    }
  });
});
