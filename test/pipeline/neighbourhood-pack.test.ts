import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNeighbourhoods, type NeighbourhoodShard } from '../../src/core/address/neighbourhoods';
import { buildNeighbourhoodPack, parseCsv, readHoodRows, writeNeighbourhoodPack, type HoodRow } from '../../pipeline/build/neighbourhood-pack';

const row = (city: string, district: string, neighbourhood: string, postcode: string): HoodRow => ({ city, district, neighbourhood, postcode });

describe('parseCsv', () => {
  it('reads plain, quoted and multi-line cells with LF, CRLF and a BOM', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('﻿a,b\n"x, y","say ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCsv('a\n"line\nbreak"\n')).toEqual([['a'], ['line\nbreak']]);
    expect(parseCsv('a,b\n\n\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('readHoodRows', () => {
  it('maps the columns and trims the cells', () => {
    expect(readHoodRows('city,district,neighborhood,postcode\n İstanbul , Kadıköy ,Moda, 34710 \n')).toEqual([row('İstanbul', 'Kadıköy', 'Moda', '34710')]);
  });

  it('refuses a file with other columns', () => {
    expect(() => readHoodRows('il,ilce,mahalle,kod\nx,y,z,1\n')).toThrow('unexpected header');
    expect(() => readHoodRows('')).toThrow('unexpected header');
  });
});

describe('buildNeighbourhoodPack', () => {
  const good = [
    row('İstanbul', 'Kadıköy', 'Moda Mah', '34710'),
    row('İstanbul', 'Kadıköy', 'Hasanpaşa', '34710'),
    row('İstanbul', 'Üsküdar', 'Fener', '34660'),
    row('Ankara', 'Çankaya', 'Yıldız', '06100'),
  ];

  it('groups by province, district and postcode with sorted names', () => {
    const { shards, index, stats } = buildNeighbourhoodPack([...good].reverse(), 'unit test');
    expect([...shards.keys()]).toEqual(['06', '34']);
    expect((shards.get('34') as NeighbourhoodShard).districts).toEqual([
      { name: 'Kadıköy', groups: [['34710', ['Hasanpaşa', 'Moda Mah']]] },
      { name: 'Üsküdar', groups: [['34660', ['Fener']]] },
    ]);
    expect(index).toMatchObject({ v: 1, source: 'unit test', count: 4, codes: { '06100': ['06/Çankaya'], '34660': ['34/Üsküdar'], '34710': ['34/Kadıköy'] } });
    expect(stats).toEqual({ rows: 4, kept: 4, provinces: 2, districts: 3, postcodes: 3 });
  });

  it('spells districts the way the SDK does, whatever the file wrote', () => {
    const { shards } = buildNeighbourhoodPack([row('ISTANBUL', 'KADIKOY', 'Moda', '34710')], 'x');
    expect((shards.get('34') as NeighbourhoodShard).districts[0]?.name).toBe('Kadıköy');
  });

  it('rejects rows it cannot trust and says why', () => {
    const { rejected, stats } = buildNeighbourhoodPack(
      [
        ...good,
        row('Atlantis', 'Merkez', 'X', '34710'),
        row('İstanbul', 'Yokilçe', 'X', '34710'),
        row('İstanbul', 'Kadıköy', 'X', '3471'),
        row('İstanbul', 'Kadıköy', 'X', '06100'),
        row('İstanbul', 'Kadıköy', '   ', '34710'),
        row('İstanbul', 'Kadıköy', 'Moda Mah', '34710'),
      ],
      'x',
    );
    expect(rejected.map((r) => r.reason)).toEqual(['unknown_province', 'unknown_district', 'bad_postcode', 'plate_mismatch', 'empty_name', 'duplicate']);
    expect(rejected[0]).toMatchObject({ line: 6, row: 'Atlantis,Merkez,X,34710' });
    expect(stats.kept).toBe(4);
  });

  it('keeps one name under two postcodes', () => {
    const { shards } = buildNeighbourhoodPack([row('Ankara', 'Çankaya', 'Yıldız', '06100'), row('Ankara', 'Çankaya', 'Yıldız', '06200')], 'x');
    expect((shards.get('06') as NeighbourhoodShard).districts[0]?.groups).toEqual([['06100', ['Yıldız']], ['06200', ['Yıldız']]]);
  });

  it('builds the same pack from the same rows', () => {
    const a = buildNeighbourhoodPack(good, 's');
    const b = buildNeighbourhoodPack([...good].reverse(), 's');
    expect(JSON.stringify([...a.shards])).toBe(JSON.stringify([...b.shards]));
    expect(JSON.stringify(a.index)).toBe(JSON.stringify(b.index));
  });
});

describe('writeNeighbourhoodPack', () => {
  it('writes the index and one file per province, replaces old files and gives a stable checksum', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'hoods-')), 'pack');
    const build = buildNeighbourhoodPack([row('İstanbul', 'Kadıköy', 'Moda', '34710'), row('Ankara', 'Çankaya', 'Yıldız', '06100')], 'unit test');
    const first = writeNeighbourhoodPack(build, out);
    expect(readdirSync(out).sort()).toEqual(['06.json', '34.json', 'index.json']);
    expect(first.files).toEqual(['index.json', '06.json', '34.json']);
    expect(writeNeighbourhoodPack(build, out).checksum).toBe(first.checksum);
    const other = writeNeighbourhoodPack(buildNeighbourhoodPack([row('İstanbul', 'Kadıköy', 'Moda', '34710')], 'unit test'), out);
    expect(readdirSync(out).sort()).toEqual(['34.json', 'index.json']);
    expect(other.checksum).not.toBe(first.checksum);
  });

  it('can be read back by the runtime directory', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'hoods-')), 'pack');
    writeNeighbourhoodPack(buildNeighbourhoodPack([row('İstanbul', 'Kadıköy', 'Moda Mah', '34710')], 'unit test'), out);
    const hoods = createNeighbourhoods({
      index: JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')),
      load: async (plate) => JSON.parse(readFileSync(join(out, `${plate}.json`), 'utf8')),
    });
    expect(hoods.areasOf('34710')).toEqual([{ plate: '34', district: 'Kadıköy' }]);
    expect(await hoods.postcodeOf('34', 'Kadıköy', 'moda')).toBe('34710');
  });
});
