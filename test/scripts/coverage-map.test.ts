import { levelOf, scoreOf, weakOf } from '../../scripts/coverage-map';

describe('scoreOf', () => {
  it('gives no score to nothing, a middle score to doors alone and full marks to a dense, linked, streeted area', () => {
    expect(scoreOf({ buildings: 0, doors: 0, linked: 0, streetKm: 0 })).toBe(0);
    expect(scoreOf({ buildings: 0, doors: 5, linked: 0, streetKm: 0 })).toBe(50);
    expect(scoreOf({ buildings: 100, doors: 100, linked: 100, streetKm: 10 })).toBe(100);
    expect(scoreOf({ buildings: 100, doors: 0, linked: 50, streetKm: 0 })).toBe(15);
  });
});

describe('levelOf and weakOf', () => {
  it('names the level and says why an area is weak, only for areas with enough buildings', () => {
    expect(levelOf({ buildings: 10, score: 0 })).toBe('az bina');
    expect(levelOf({ buildings: 100, score: 70 })).toBe('iyi');
    expect(levelOf({ buildings: 100, score: 45 })).toBe('orta');
    expect(levelOf({ buildings: 100, score: 30 })).toBe('zayıf');
    expect(levelOf({ buildings: 100, score: 10 })).toBe('çok zayıf');
    expect(weakOf({ buildings: 10, doors: 0, linked: 0, streets: 0, score: 0, unnamedRoads: 0 })).toEqual([]);
    expect(weakOf({ buildings: 100, doors: 0, linked: 10, streets: 0, score: 5, unnamedRoads: 30 })).toEqual(['kapı yok denecek kadar az', 'binaların çoğu sokağa bağlı değil', 'adlı sokak yok', 'adsız yol adlı sokaktan çok']);
    expect(weakOf({ buildings: 100, doors: 50, linked: 90, streets: 8, score: 80, unnamedRoads: 2 })).toEqual([]);
    expect(weakOf({ buildings: 100, doors: 40, linked: 90, streets: 8, score: 20, unnamedRoads: 2 })).toEqual([]);
  });
});
