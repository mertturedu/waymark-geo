import { compassRotation, compassVisible, northView, signedBearing } from '../../src/native/logic/compass';
import { pickPlace } from '../../src/native/logic/place-pick';
import { metersPerPixel, scaleBar, scaleLabel, SCALE_STEPS_M } from '../../src/native/logic/scale';
import { resolveScheme } from '../../src/native/logic/scheme';

describe('scale bar', () => {
  it('knows the metres in a pixel at the equator and at 41 degrees', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.517, 2);
    expect(metersPerPixel(15, 0)).toBeCloseTo(2.3887, 3);
    expect(metersPerPixel(15, 41) / metersPerPixel(15, 0)).toBeCloseTo(Math.cos((41 * Math.PI) / 180), 6);
  });

  it.each([
    [10, 41, 5000],
    [12, 41, 1000],
    [14, 41, 200],
    [15, 41, 100],
    [16, 41, 50],
    [17, 41, 20],
    [19, 41, 10],
  ])('at zoom %d and latitude %d the bar is %d m', (zoom, lat, meters) => {
    expect(scaleBar(zoom, lat)?.meters).toBe(meters);
  });

  it('stays inside the largest width and rounds the pixels', () => {
    for (let zoom = 3; zoom <= 20; zoom += 0.5) {
      const bar = scaleBar(zoom, 41);
      if (!bar) continue;
      expect(bar.widthPx).toBeLessThanOrEqual(110);
      expect(Number.isInteger(bar.widthPx)).toBe(true);
      expect(SCALE_STEPS_M).toContain(bar.meters);
    }
  });

  it('is wider at the equator for the same zoom and gives nothing for bad input', () => {
    expect(scaleBar(16, 0)!.meters).toBeGreaterThanOrEqual(scaleBar(16, 60)!.meters);
    expect(scaleBar(NaN, 41)).toBeNull();
    expect(scaleBar(16, NaN)).toBeNull();
    expect(scaleBar(16, 41, 0)).toBeNull();
    expect(scaleBar(30, 41)).toBeNull();
  });

  it('writes the unit in all six languages', () => {
    expect(scaleLabel(200, 'tr')).toBe('200 m');
    expect(scaleLabel(1000, 'en')).toBe('1 km');
    expect(scaleLabel(2000, 'de')).toBe('2 km');
    expect(scaleLabel(500, 'ar')).toBe('500 م');
    expect(scaleLabel(5000, 'ru')).toBe('5 км');
    expect(scaleLabel(10000, 'el')).toBe('10 χλμ');
  });
});

describe('compass', () => {
  it('is hidden when the map points north and visible when it turns', () => {
    expect(compassVisible(0)).toBe(false);
    expect(compassVisible(0.4)).toBe(false);
    expect(compassVisible(359.7)).toBe(false);
    expect(compassVisible(90)).toBe(true);
    expect(compassVisible(-30)).toBe(true);
    expect(compassVisible(NaN)).toBe(false);
  });

  it('turns the needle against the map bearing by the short way', () => {
    expect(signedBearing(90)).toBe(90);
    expect(signedBearing(270)).toBe(-90);
    expect(compassRotation(90)).toBe(-90);
    expect(compassRotation(350)).toBe(10);
  });

  it('faces north and keeps the tilt and the rest of the view', () => {
    expect(northView({ center: [29, 41] as [number, number], zoom: 16, bearing: 90, pitch: 20 })).toEqual({ center: [29, 41], zoom: 16, bearing: 0, pitch: 20 });
    expect(northView({ bearing: 10 })).toEqual({ bearing: 0 });
  });
});

describe('pickPlace', () => {
  const near = { x: 100, y: 100, tier: 3, item: 'near' };
  it('takes the nearest badge inside 24 px', () => {
    expect(pickPlace([{ ...near, x: 110 }, { x: 105, y: 100, tier: 3, item: 'closer' }], { x: 100, y: 100 })).toBe('closer');
  });

  it('gives null when everything is farther than 24 px or there is nothing', () => {
    expect(pickPlace([{ ...near, x: 130 }], { x: 100, y: 100 })).toBeNull();
    expect(pickPlace([], { x: 1, y: 1 })).toBeNull();
    expect(pickPlace([{ ...near, x: NaN }], { x: 100, y: 100 })).toBeNull();
  });

  it('counts exactly 24 px as inside and a bigger radius when asked', () => {
    expect(pickPlace([{ ...near, x: 124 }], { x: 100, y: 100 })).toBe('near');
    expect(pickPlace([{ ...near, x: 140 }], { x: 100, y: 100 }, 50)).toBe('near');
  });

  it('prefers the more important tier when two badges are the same distance away', () => {
    const pair = [{ x: 110, y: 100, tier: 3, item: 'pharmacy' }, { x: 90, y: 100, tier: 1, item: 'hospital' }];
    expect(pickPlace(pair, { x: 100, y: 100 })).toBe('hospital');
    expect(pickPlace([...pair].reverse(), { x: 100, y: 100 })).toBe('hospital');
  });

  it('does not let a tier beat a clearly nearer badge', () => {
    expect(pickPlace([{ x: 101, y: 100, tier: 4, item: 'cafe' }, { x: 118, y: 100, tier: 1, item: 'hospital' }], { x: 100, y: 100 })).toBe('cafe');
  });
});

describe('resolveScheme', () => {
  it('follows the system for auto and keeps a fixed choice', () => {
    expect(resolveScheme('auto', 'dark')).toBe('dark');
    expect(resolveScheme('auto', 'light')).toBe('light');
    expect(resolveScheme('auto', null)).toBe('light');
    expect(resolveScheme('auto', undefined)).toBe('light');
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });
});
