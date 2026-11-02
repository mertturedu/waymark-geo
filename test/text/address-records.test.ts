import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressRecord } from '../../scripts/build-address-records';
import { provinceName } from '../../src/core/text/admin';

const { records } = JSON.parse(readFileSync(join(process.cwd(), 'fixtures/address-records.json'), 'utf8')) as { records: AddressRecord[] };

describe('fixtures/address-records.json', () => {
  it('holds 250 records from each of the twelve priority provinces', () => {
    const counts = new Map<string, number>();
    for (const r of records) counts.set(r.province, (counts.get(r.province) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59']);
    for (const count of counts.values()) expect(count).toBe(250);
    expect(records).toHaveLength(3000);
  });

  it('names every province the way the embedded list does', () => {
    for (const r of records) expect(provinceName(r.province)).toBe(r.provinceName);
  });

  it('has a street, a house number and a district on every record, and no duplicates', () => {
    const keys = new Set<string>();
    for (const r of records) {
      expect(r.street.length).toBeGreaterThan(2);
      expect(r.houseNumber).toMatch(/^\d/);
      expect(r.district).not.toBe('');
      keys.add([r.province, r.district, r.neighbourhood, r.street, r.houseNumber].join('|'));
    }
    expect(keys.size).toBe(records.length);
  });

  it('keeps neighbourhoods without their word Mahallesi', () => {
    expect(records.some((r) => r.neighbourhood && /\s(Mahallesi|Mah\.?)$/i.test(r.neighbourhood))).toBe(false);
    expect(records.filter((r) => r.neighbourhood !== null).length).toBeGreaterThan(2900);
  });
});
