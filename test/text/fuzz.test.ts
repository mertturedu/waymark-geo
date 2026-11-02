import { parseAddress } from '../../src/core/text/parse';
import { fuzzInput, measureFuzz, rng, shapeProblem, measureSpeed } from './helpers/measure';

describe('K1.3: broken input', () => {
  it('never throws and always returns a well formed result (10,000 inputs)', () => {
    const result = measureFuzz(10_000, 7);
    expect(result.errors).toEqual([]);
    expect(result.badShape).toEqual([]);
  });

  it.each([
    '',
    '\u0000'.repeat(50),
    '😀'.repeat(400),
    '‮‭'.repeat(300),
    'ا'.repeat(1000),
    '9'.repeat(5000),
    'no '.repeat(500),
    'a/'.repeat(300),
    '-'.repeat(600),
    '\ud800'.repeat(10) + 'abc',
    'İ'.repeat(700),
  ])('survives %j', (text) => {
    expect(shapeProblem(text, parseAddress(text))).toBeNull();
  });

  it('cuts input longer than 500 characters', () => {
    const parsed = parseAddress('a '.repeat(2000) + 'Atatürk Cd. 5');
    expect(parsed.input.length).toBeLessThanOrEqual(500);
  });

  it('makes inputs of every kind', () => {
    const next = rng(1);
    const inputs = Array.from({ length: 2000 }, () => fuzzInput(next));
    expect(inputs.some((text) => text.length > 500)).toBe(true);
    expect(inputs.some((text) => text.length === 0)).toBe(true);
    expect(inputs.some((text) => /[؀-ۿ]/.test(text))).toBe(true);
    expect(inputs.some((text) => /\n/.test(text))).toBe(true);
  });

  it('reports a wrong result shape', () => {
    const parsed = parseAddress('Atatürk Cd. 5');
    expect(shapeProblem('Atatürk Cd. 5', { ...parsed, houseNumber: 5 as unknown as string })).toBe('houseNumber');
    expect(shapeProblem('Atatürk Cd. 5', { ...parsed, leftover: [1] as unknown as string[] })).toBe('leftover');
    expect(shapeProblem('Atatürk Cd. 5', { ...parsed, input: 'y' })).toBe('input changed');
  });
});

describe('K1.3: speed in Node', () => {
  it('stays far from the limits while tests run in parallel with coverage (the strict limits are measured by the gate)', () => {
    const texts = ['Kadıköy, Moda Mah., Bahariye Cd. 14', 'Стамбул Кадыкёй ул. Ататюрк 5', 'Atatürk Straße 5, Kadıköy, Istanbul', 'balikesir karesi pasaalani mah 1. sk no 12 d 3', 'شارع أتاتورك رقم ٥ طابق ٣'];
    const speed = measureSpeed(texts, 5000);
    expect(speed.p99).toBeLessThan(10);
    expect(speed.max).toBeLessThan(250);
    expect(speed.first).toBeLessThan(250);
  });
});
