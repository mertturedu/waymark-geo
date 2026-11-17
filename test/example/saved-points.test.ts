import { savedPoints } from '../../example/src/sdk/saved';

const line = (key: string, text: string, confirmations: { lng: number; lat: number; at: number }[]) => JSON.stringify({ v: 1, key, region: '34', text, confirmations: confirmations.map((c) => ({ source: 'pin', ...c })) });

describe('savedPoints', () => {
  it('lists each saved door with its latest point and confirmation count, newest first', () => {
    const list = savedPoints([
      line('a', 'Gül Sokak No:3', [{ lng: 29.1, lat: 40.1, at: 100 }, { lng: 29.2, lat: 40.2, at: 300 }]),
      line('b', 'Zeytin Sokak No:5', [{ lng: 28.5, lat: 40.5, at: 200 }]),
    ]);
    expect(list).toEqual([
      { key: 'a', text: 'Gül Sokak No:3', point: [29.2, 40.2], count: 2, at: 300 },
      { key: 'b', text: 'Zeytin Sokak No:5', point: [28.5, 40.5], count: 1, at: 200 },
    ]);
  });

  it('takes the later one when two confirmations carry the same time', () => {
    expect(savedPoints([line('a', 'Gül', [{ lng: 28.6, lat: 40.6, at: 5 }, { lng: 28.60001, lat: 40.60001, at: 5 }])])[0]?.point).toEqual([28.60001, 40.60001]);
  });

  it('skips lines that are broken or have no confirmation', () => {
    expect(savedPoints(['{bozuk', JSON.stringify({ key: 'x' }), line('c', 'Boş', []), '', line('d', 'Tamam', [{ lng: 1, lat: 2, at: 1 }])]).map((p) => p.key)).toEqual(['d']);
  });

  it('skips a point that is not a coordinate', () => {
    expect(savedPoints([line('e', 'Sayı değil', [{ lng: Number.NaN, lat: 2, at: 1 }])])).toEqual([]);
  });

  it('gives an empty list for nothing saved', () => {
    expect(savedPoints([])).toEqual([]);
  });
});
