import { ROAD_CLASSES, bucketOf, ferryDeciseconds, junctionPenalty, parseMaxspeed, roadKmh, speedKmh, speedTable, travelDeciseconds } from '../../src/core/route/speeds';

describe('parseMaxspeed', () => {
  it('reads plain numbers and mph', () => {
    expect(parseMaxspeed('50')).toBe(50);
    expect(parseMaxspeed(' 90 ')).toBe(90);
    expect(parseMaxspeed('30 mph')).toBeCloseTo(48.28, 1);
    expect(parseMaxspeed('50 km/h')).toBe(50);
  });

  it('knows the Turkish named limits', () => {
    expect(parseMaxspeed('TR:urban')).toBe(50);
    expect(parseMaxspeed('TR:rural')).toBe(90);
    expect(parseMaxspeed('TR:motorway')).toBe(120);
    expect(parseMaxspeed('walk')).toBe(7);
  });

  it('gives up on anything it cannot trust', () => {
    for (const text of ['constructor', '__proto__', 'toString', null, undefined, '', 'none', 'signals', 'variable', 'abc', '0', '-5', '300', '50;60', '30 knots', 'DE:urban']) {
      expect(parseMaxspeed(text)).toBeNull();
    }
  });
});

describe('speedKmh', () => {
  it('uses the class table when there is no limit', () => {
    expect(speedKmh('motorway', null)).toBe(100);
    expect(speedKmh('living_street', null)).toBe(15);
    expect(speedKmh('primary', null)).toBe(60);
  });

  it('slows side streets to what drivers actually reach', () => {
    expect(speedKmh('residential', null)).toBeCloseTo(19.5, 5);
    expect(speedKmh('service', null)).toBeCloseTo(13, 5);
    expect(speedKmh('unclassified', null)).toBeCloseTo(26, 5);
    expect(speedKmh('residential', '40')).toBeCloseTo(23.4, 5);
    expect(speedKmh('tertiary', null)).toBe(45);
  });

  it('trusts a posted limit but not blindly', () => {
    expect(speedKmh('secondary', '70')).toBeCloseTo(63, 5);
    expect(speedKmh('residential', '20')).toBeCloseTo(11.7, 5);
    expect(speedKmh('tertiary', '20')).toBeCloseTo(18, 5);
    expect(speedKmh('motorway', '120')).toBeCloseTo(108, 5);
  });

  it('never goes below walking pace', () => {
    expect(speedKmh('service', '5')).toBeGreaterThanOrEqual(5);
  });
});

describe('roadKmh', () => {
  const quiet = { near: 3, wide: 200, lengthM: 400 };
  const busy = { near: 120, wide: 8000, lengthM: 400 };

  it('slows city arteries where junctions are dense', () => {
    expect(roadKmh('primary', null, busy)).toBeLessThan(roadKmh('primary', null, quiet));
    expect(roadKmh('secondary', null, busy)).toBeLessThan(roadKmh('secondary', null, quiet));
    expect(roadKmh('motorway', null, busy)).toBeLessThan(roadKmh('motorway', null, quiet));
  });

  it('slows short blocks between junctions', () => {
    expect(roadKmh('primary', null, { ...quiet, lengthM: 30 })).toBeLessThan(roadKmh('primary', null, { ...quiet, lengthM: 1500 }));
  });

  it('keeps side streets near what drivers reach', () => {
    const kmh = roadKmh('residential', null, { near: 30, wide: 3000, lengthM: 100 });
    expect(kmh).toBeGreaterThan(15);
    expect(kmh).toBeLessThan(25);
  });

  it('reads an unknown limit like no limit', () => {
    expect(roadKmh('trunk', 'signals', quiet)).toBe(roadKmh('trunk', null, quiet));
  });

  it('stays between walking pace and the highest limit', () => {
    for (const cls of ROAD_CLASSES) {
      for (const road of [quiet, busy, { near: 0, wide: 0, lengthM: 0 }, { near: 1e9, wide: 1e9, lengthM: 1e9 }]) {
        const kmh = roadKmh(cls, '140', road);
        expect(kmh).toBeGreaterThanOrEqual(5);
        expect(kmh).toBeLessThanOrEqual(140);
      }
    }
  });

  it('leaves ferries to the ferry table', () => {
    expect(roadKmh('ferry', null, busy)).toBe(20);
  });

  it('puts a value on the right side of each bucket edge', () => {
    expect(bucketOf(1.99, [2, 5])).toBe(0);
    expect(bucketOf(2, [2, 5])).toBe(1);
    expect(bucketOf(5, [2, 5])).toBe(2);
  });
});

describe('travel time', () => {
  it('counts whole deciseconds and never zero for a real segment', () => {
    expect(travelDeciseconds(1000, 36)).toBe(1000);
    expect(travelDeciseconds(0.01, 100)).toBe(1);
    expect(travelDeciseconds(500, 30)).toBe(600);
  });

  it('charges a ferry its posted duration, boarding once, or a slow default', () => {
    expect(ferryDeciseconds(5000, 1800, true)).toBe(1800 * 10 + 3000);
    expect(ferryDeciseconds(5000, 1800, false)).toBe(1800 * 10);
    expect(ferryDeciseconds(5000, 600.4, false)).toBe(6004);
    expect(ferryDeciseconds(5000, null, true)).toBeGreaterThan(5000 / (20 / 3.6) * 10);
    expect(ferryDeciseconds(5000, null, false)).toBe(travelDeciseconds(5000, 20));
  });

  it('waits longer at junctions off ramps and service roads than on main roads', () => {
    expect(junctionPenalty('residential')).toBeGreaterThan(0);
    expect(junctionPenalty('motorway_link')).toBeGreaterThan(junctionPenalty('motorway'));
    expect(junctionPenalty('service')).toBeGreaterThan(junctionPenalty('primary'));
    expect(junctionPenalty('ferry')).toBe(0);
  });
});

describe('speedTable', () => {
  it('hands out the numbers the model uses, as a copy', () => {
    const table = speedTable();
    expect(table.class.residential).toBe(30);
    expect(table.streets).toEqual({ classes: ['residential', 'service', 'unclassified'], factor: 0.65 });
    expect(table.named['TR:urban']).toBe(parseMaxspeed('TR:urban'));
    expect(table.posted).toBe(0.9);
    expect(table.min).toBe(5);
    expect(table.max).toBe(140);
    table.class.residential = 1;
    table.streets.classes.pop();
    expect(speedTable().class.residential).toBe(30);
    expect(speedTable().streets.classes).toHaveLength(3);
  });
});
