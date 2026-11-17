import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAdmin, districtCount, findDistrict, findProvince, provinceIds, provinceName } from '../../src/core/text/admin';
import type { AdminData } from '../../src/core/text/types';

const data: AdminData = {
  provinces: [
    { plate: '06', names: { tr: 'Ankara', en: 'Ankara' }, alt: [] },
    { plate: '34', names: { tr: 'İstanbul', en: 'Istanbul', ru: 'Стамбул', el: 'Κωνσταντινούπολη', ar: 'إسطنبول' }, alt: ['Stanbul'] },
    { plate: '76', names: { tr: 'Iğdır' }, alt: [] },
    { plate: '99', names: { tr: 'Deneme' }, alt: [] },
  ],
  districts: [
    { province: '06', names: { tr: 'Çankaya' }, alt: [] },
    { province: '06', names: { tr: 'Merkez' }, alt: ['Ankara Merkez'] },
    { province: '34', names: { tr: 'Kadıköy', ru: 'Кадыкёй' }, alt: [] },
    { province: '34', names: { tr: 'Üsküdar' }, alt: ['Scutari'] },
    { province: '76', names: { tr: 'Merkez' }, alt: ['Iğdır Merkez'] },
    { province: '76', names: { tr: 'Aralık' }, alt: [] },
    { province: '99', names: { tr: 'Çankaya' }, alt: [] },
  ],
};

describe('createAdmin with small data', () => {
  const admin = createAdmin(data);

  it('finds a province by any language and alternative name', () => {
    expect(admin.findProvince('istanbul')).toEqual({ id: '34', name: 'İstanbul', plate: '34', ambiguous: false });
    expect(admin.findProvince('İSTANBUL')?.id).toBe('34');
    expect(admin.findProvince('Istanbul')?.id).toBe('34');
    expect(admin.findProvince('Стамбул')?.id).toBe('34');
    expect(admin.findProvince('Κωνσταντινούπολη')?.id).toBe('34');
    expect(admin.findProvince('إسطنبول')?.id).toBe('34');
    expect(admin.findProvince('stanbul')?.id).toBe('34');
    expect(admin.findProvince('igdir')?.id).toBe('76');
  });

  it('does not invent names that the data does not have', () => {
    expect(admin.findProvince('Άγκυρα')).toBeNull();
    expect(admin.findProvince('stambul ili')).toBeNull();
    expect(admin.findProvince('')).toBeNull();
    expect(admin.findProvince('12')).toBeNull();
  });

  it('finds a district and tells its province', () => {
    expect(admin.findDistrict('kadikoy')).toEqual([{ id: '34/kadikoy', name: 'Kadıköy', plate: '34', ambiguous: false }]);
    expect(admin.findDistrict('Кадыкёй')[0]?.plate).toBe('34');
    expect(admin.findDistrict('scutari')[0]?.name).toBe('Üsküdar');
    expect(admin.findDistrict('zzz')).toEqual([]);
  });

  it('marks a district name used in several provinces as ambiguous until the province narrows it', () => {
    const all = admin.findDistrict('cankaya');
    expect(all.map((m) => m.plate)).toEqual(['06', '99']);
    expect(all.every((m) => m.ambiguous)).toBe(true);
    expect(admin.findDistrict('cankaya', '06')).toEqual([{ id: '06/cankaya', name: 'Çankaya', plate: '06', ambiguous: false }]);
    expect(admin.findDistrict('cankaya', '34')).toEqual([]);
    expect(admin.findDistrict('merkez').map((m) => m.plate)).toEqual(['06', '76']);
  });

  it('knows the Merkez district of each province by its long name', () => {
    expect(admin.findDistrict('ankara merkez').map((m) => m.plate)).toEqual(['06']);
    expect(admin.findDistrict('igdir merkez', '76')[0]?.name).toBe('Merkez');
  });

  it('finds a province by its plate', () => {
    expect(admin.provinceByPlate('34')).toEqual({ id: '34', name: 'İstanbul', plate: '34', ambiguous: false });
    expect(admin.provinceByPlate('00')).toBeNull();
  });

  it('reports sizes and ids', () => {
    expect(admin.provinceIds()).toEqual(['06', '34', '76', '99']);
    expect(admin.districtCount()).toBe(7);
    expect(admin.provinceName('34')).toBe('İstanbul');
    expect(admin.provinceName('00')).toBeNull();
  });

  it('answers whether a word is a province or a district name', () => {
    expect(admin.isProvinceName('igdir')).toBe(true);
    expect(admin.isProvinceName('kadikoy')).toBe(false);
    expect(admin.isDistrictName('kadikoy')).toBe(true);
    expect(admin.isDistrictName('istanbul')).toBe(false);
  });

  it('marks a province name that two provinces share', () => {
    const clash = createAdmin({ provinces: [{ plate: '01', names: { tr: 'Aa' }, alt: [] }, { plate: '02', names: { tr: 'Bb' }, alt: ['Aa'] }], districts: [] });
    expect(clash.findProvince('aa')).toMatchObject({ ambiguous: true });
  });
});

describe('embedded Turkey data', () => {
  const report = readFileSync(join(process.cwd(), 'src/core/text/data/admin.json'), 'utf8');
  const embedded = JSON.parse(report) as AdminData;

  it('has all 81 provinces with plates 1 to 81', () => {
    expect(provinceIds()).toEqual(Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0')));
    expect(embedded.provinces).toHaveLength(81);
  });

  it('finds every province by its Turkish name and plain spelling', () => {
    for (const province of embedded.provinces) {
      expect(findProvince(province.names.tr as string)?.id).toBe(province.plate);
    }
  });

  it('counts the districts that the data holds', () => {
    expect(districtCount()).toBe(embedded.districts.length);
    expect(districtCount()).toBeGreaterThan(960);
    expect(districtCount()).toBeLessThan(990);
  });

  it('knows well known places', () => {
    expect(findProvince('izmir')?.id).toBe('35');
    expect(findProvince('Стамбул')?.id).toBe('34');
    expect(findDistrict('kadikoy', '34')).toHaveLength(1);
    expect(findDistrict('merkez').length).toBeGreaterThan(10);
    expect(provinceName('10')).toBe('Balıkesir');
    expect(provinceName('76')).toBe('Iğdır');
  });

  it('keeps the embedded file small', () => {
    expect(report.length).toBeLessThan(300_000);
  });
});

describe('embedded list short names', () => {
  it.each([['Antep', '27'], ['Maraş', '46'], ['Urfa', '63'], ['Afyon', '03'], ['İçel', '33']])('reads %s as province %s', (name, plate) => {
    expect(findProvince(name)).toMatchObject({ id: plate, ambiguous: false });
  });

  it('keeps those short names apart from every district name', () => {
    for (const name of ['Antep', 'Maraş', 'Urfa', 'Afyon', 'İçel']) expect(findDistrict(name)).toEqual([]);
  });
});
