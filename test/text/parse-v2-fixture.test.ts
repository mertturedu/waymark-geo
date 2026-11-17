import fixture from '../../fixtures/parse-v2.json';
import { parseAddress } from '../../src/core/text';
import { streetKey } from '../../src/core/text/street';
import { summaryOf, type ParseSummary } from '../../src/core/text/summary';
import type { ParseCase } from '../../scripts/build-parse-v2';

const cases = fixture.cases as unknown as ParseCase[];
const flat = (value: string | null | undefined): string => (value ?? '').toLocaleLowerCase('tr-TR').replace(/[^0-9a-zçğıöşü]/g, '');

describe('fixtures/parse-v2.json', () => {
  it('has at least 3,000 cases, a third of them with unit expressions', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3000);
    expect(cases.filter((c) => c.truth.unit).length).toBeGreaterThanOrEqual(1000);
  });

  it('is read exactly as recorded', () => {
    const different = cases.filter((c) => JSON.stringify(summaryOf(parseAddress(c.text))) !== JSON.stringify(c.expect as ParseSummary)).map((c) => c.id);
    expect(different).toEqual([]);
  });

  it('keeps street and number accuracy against the recorded truth', () => {
    const street = cases.filter((c) => summaryOf(parseAddress(c.text)).street === streetKey(c.truth.street).key).length / cases.length;
    const number = cases.filter((c) => {
      const parsed = parseAddress(c.text);
      const options = [parsed, ...parsed.alternatives].map((p) => flat(p.houseNumber).replace(/^(numara|no|n)(?=\d)/, ''));
      return options.includes(flat(c.truth.number));
    }).length / cases.length;
    expect(street).toBeGreaterThan(0.85);
    expect(number).toBeGreaterThan(0.95);
  });

  it('reads the floor, door and block of every unit expression it was given', () => {
    const unitCases = cases.filter((c) => c.truth.unit);
    const right = (key: 'floor' | 'door' | 'block'): number => {
      const wanted = unitCases.filter((c) => c.truth.unit?.[key] !== undefined);
      const good = wanted.filter((c) => {
        const parsed = parseAddress(c.text);
        return [parsed, ...parsed.alternatives].some((p) => flat(p[key]) === flat(c.truth.unit?.[key]));
      });
      return good.length / Math.max(1, wanted.length);
    };
    expect(right('floor')).toBeGreaterThan(0.98);
    expect(right('door')).toBeGreaterThan(0.93);
    expect(right('block')).toBeGreaterThan(0.93);
  });
});
