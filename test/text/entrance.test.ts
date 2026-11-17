import { parseAddress } from '../../src/core/text/parse';

const unit = (text: string) => {
  const r = parseAddress(text);
  return { block: r.block, entrance: r.entrance, floor: r.floor, door: r.door, no: r.houseNumber, left: r.leftover };
};

describe('entrance, ground floor and basement in written addresses', () => {
  it('reads the entrance after or before its word, in several languages', () => {
    expect(unit('Bağdat Caddesi 12 B Blok Giriş 2 Kat 3 Daire 7 Kadıköy')).toEqual({ block: 'b', entrance: '2', floor: '3', door: '7', no: '12', left: [] });
    expect(unit('Moda Sk. No 4 2. giriş kat 1 daire 2')).toMatchObject({ entrance: '2', floor: '1', door: '2', no: '4' });
    expect(unit('Moda Sk. No 4 Giriş: b daire 2')).toMatchObject({ entrance: 'B', door: '2' });
    expect(unit('Moda Sk. No 4 giriş no 3').entrance).toBe('3');
    expect(unit('Eingang 3 Hauptstr 5')).toMatchObject({ entrance: '3', no: '5' });
    expect(unit('Main Street 5 Entrance 2').entrance).toBe('2');
  });

  it('keeps "giriş kat" as the ground floor and leaves a block letter alone', () => {
    expect(unit('Gül Sokak 5 Giriş Kat Kadıköy')).toMatchObject({ entrance: null, floor: 'zemin' });
    expect(unit('Gül Sokak 5 Giriş Katı')).toMatchObject({ entrance: null, floor: 'zemin' });
    expect(unit('Gül Sokak 5 Giriş A Blok Daire 3')).toMatchObject({ entrance: null, block: 'a', door: '3' });
    expect(unit('Gül Sokak 5').entrance).toBeNull();
  });

  it('tells the second basement floor from the first', () => {
    expect(unit('Gül Sokak 5 Kat -2 Daire 3').floor).toBe('-2');
    expect(unit('Gül Sokak 5 2. bodrum kat').floor).toBe('-2');
    expect(unit('Gül Sokak 5 -2. kat').floor).toBe('-2');
    expect(unit('Gül Sokak 5 -1. kat').floor).toBe('bodrum');
    expect(unit('Gül Sokak 5 1. bodrum').floor).toBe('bodrum');
  });
});
