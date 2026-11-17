import { derive, mergeOverture, MULTI } from '../../scripts/hints-overture';
import { displayName, selectHints, tight, type HoodGeo, type RawHint } from '../../scripts/hints-build';

const hood = (id: number, name: string, district = 'Çivril'): HoodGeo => ({ id, sid: `H${id}`, name, district, centre: [29 + id / 100, 38], radiusM: 700 });
const raw = (sid: string, street: string): RawHint => ({ plate: '20', district: 'Çivril', hood: 'x', sid, street, key: '', sources: 2 });
const known = (byDistrict: string[] = [], byHood: string[] = []) => ({ byDistrict: new Set(byDistrict), byHood: new Set(byHood) });

describe('sokak ipucu seçimi', () => {
  it('pakette olmayan sokağı mahalle merkeziyle ipucu yapar', () => {
    const r = selectHints([raw('H1', 'Yenipınar Caddesi')], [hood(1, 'İğdir')], known());
    expect(r.hints).toEqual([{ district: 'civril', name: 'Yenipınar Caddesi', point: [29.01, 38], radiusM: 700, sources: 2 }]);
  });

  it('pakette zaten olan sokağı ve aynı ilçede iki mahallede geçeni atlar', () => {
    const r = selectHints([raw('H1', 'Atatürk Caddesi'), raw('H1', 'Gül Sokak'), raw('H2', 'Gül Sokak')], [hood(1, 'İğdir'), hood(2, 'Savran')], known(['civril|ataturk']));
    expect(r.hints).toEqual([]);
    expect(r.skipped).toEqual({ 'pakette zaten var': 1, 'aynı ilçede birden çok mahallede': 1 });
  });

  it('OSM sokağı olan mahallelerde uyum oranını sayar', () => {
    const r = selectHints([raw('H1', 'Gül Sokak'), raw('H1', 'Lale Sokak')], [hood(1, 'İğdir')], known([], ['1|gul']));
    expect(r.agreement).toEqual({ n: 2, found: 1 });
  });

  it('konumu bilinmeyen mahalleyi atlar', () => {
    const r = selectHints([raw('H9', 'Gül Sokak')], [hood(1, 'İğdir')], known());
    expect(r.hints).toEqual([]);
    expect(r.skipped).toEqual({ 'mahalle konumu yok': 1 });
  });
});

describe('bitişik alıntı', () => {
  it('mahalle ve sokak yan yana ise kabul eder', () => {
    expect(tight('Yenice Mahallesi Cengiz Topel Cad. No: 8', 'Yenice', 'Cengiz Topel Caddesi')).toBe(true);
    expect(tight('Cengiz Topel Cad. Yenice Mah.', 'Yenice', 'Cengiz Topel Caddesi')).toBe(true);
  });

  it('mahalle başka bir yerde geçiyorsa reddeder', () => {
    expect(tight('Kantarcı Caddesi ile 23087. Sokağı takiben Cihadiye Parkı', 'Cihadiye', 'Kantarcı Caddesi')).toBe(false);
  });
});

describe('sokak adı gösterimi', () => {
  it('büyük harfli sözcükleri baş harfli yapar, sayı ve Romen rakamına dokunmaz', () => {
    expect(displayName('2. METERİS ÇIKMAZI Sokak')).toBe('2. Meteris Çıkmazı Sokak');
    expect(displayName('CAMİ Sokak')).toBe('Cami Sokak');
    expect(displayName('34-A. Sokak')).toBe('34-A. Sokak');
    expect(displayName('II. Murat Caddesi')).toBe('II. Murat Caddesi');
  });
});

describe('Overture sokak ipucu', () => {
  const poi = (lng: number, lat: number, conf = 80) => ({ point: [lng, lat] as [number, number], conf });

  it('yakın işletmelerin ortasından yarıçaplı ipucu çıkarır', () => {
    const d = derive([poi(29, 38), poi(29.002, 38), poi(29.001, 38.001)]);
    expect(d?.n).toBe(3);
    expect(d?.radiusM).toBeGreaterThanOrEqual(250);
  });

  it('tek işletme için 500 m yarıçaplı ipucu çıkarır, iki işletme isteyen ayarda çıkarmaz', () => {
    expect(derive([poi(29, 38)])).toEqual({ point: [29, 38], radiusM: 500, n: 1 });
    expect(derive([poi(29, 38)], MULTI)).toBeNull();
  });

  it('düşük güven ve dağınık işletmeler için ipucu çıkarmaz', () => {
    expect(derive([poi(29, 38, 20), poi(29.001, 38, 20)])).toBeNull();
    expect(derive([poi(29, 38), poi(29.2, 38)])).toBeNull();
  });

  it('mevcut ipucunu yalnızca tutarlıysa iyileştirir', () => {
    const base = [{ district: 'civril', name: 'Gül Sokağı', point: [29, 38] as [number, number], radiusM: 1000, sources: 2 }];
    const near = { district: 'civril', name: 'Gül Sokak', point: [29.001, 38] as [number, number], radiusM: 300, sources: 3 };
    const far = { district: 'civril', name: 'Gül Sokak', point: [29.5, 38] as [number, number], radiusM: 300, sources: 3 };
    expect(mergeOverture(base, [near])).toMatchObject({ added: 0, refined: 1, conflicts: 0 });
    expect(mergeOverture(base, [far])).toMatchObject({ added: 0, refined: 0, conflicts: 1 });
    expect(mergeOverture([], [near]).added).toBe(1);
  });
});
