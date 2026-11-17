import { BARE_MIN_BUILDINGS, isBare, summarize, type HoodGap } from '../../scripts/gap-map';

const hood = (extra: Partial<HoodGap> = {}): HoodGap => ({ plate: '20', district: 'Çivril', hood: 'İğdir', sid: 'H20x', source: 3, buildings: 100, named: 0, roadLinked: 80, withNumber: 0, doors: 0, streets: 0, unnamedRoads: 5, ...extra });

describe('boşluk haritası', () => {
  it('adlı sokağı ve sokak çizgisi olmayan, yeterince binalı mahalle boştur', () => {
    expect(isBare(hood())).toBe(true);
    expect(isBare(hood({ buildings: BARE_MIN_BUILDINGS - 1 }))).toBe(false);
    expect(isBare(hood({ streets: 2 }))).toBe(false);
    expect(isBare(hood({ named: 10 }))).toBe(false);
  });

  it('il özetinde bağlı olmayan binaları ve boş mahalleleri sayar', () => {
    const s = summarize('20', [hood(), hood({ buildings: 200, named: 150, roadLinked: 20, streets: 4 })]);
    expect(s).toMatchObject({ hoods: 2, buildings: 300, named: 150, roadLinked: 100, unlinked: 50, bare: 1, bareBuildings: 100, streets: 4 });
  });
});
