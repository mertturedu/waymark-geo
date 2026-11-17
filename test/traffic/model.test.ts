import { bandOf, congestion, localTime, mapSlowdown, regionBusyness, slowdownOf, trafficBucket } from '../../src/core/traffic/model';

const monday = (hour: number): number => Date.UTC(2026, 10, 9) + (hour - 3) * 3_600_000;

describe('local time in Turkey', () => {
  it('reads the hour and the kind of day from UTC plus three hours', () => {
    expect(localTime(monday(8))).toEqual({ hour: 8, day: 'weekday' });
    expect(localTime(Date.UTC(2026, 10, 7, 12))).toEqual({ hour: 15, day: 'saturday' });
    expect(localTime(Date.UTC(2026, 10, 8, 21, 30))).toEqual({ hour: 0.5, day: 'weekday' });
    expect(localTime(Date.UTC(2026, 10, 8, 20)).day).toBe('sunday');
  });
});

describe('typical congestion', () => {
  it('peaks in the morning and in the evening on weekdays and is quiet at night', () => {
    expect(congestion(monday(8))).toBeGreaterThan(0.8);
    expect(congestion(monday(18))).toBe(1);
    expect(congestion(monday(3))).toBeLessThan(0.15);
    expect(congestion(monday(12))).toBeLessThan(0.7);
  });

  it('is lighter at the weekend', () => {
    const saturday = Date.UTC(2026, 10, 7, 9);
    const sunday = Date.UTC(2026, 10, 8, 15);
    expect(congestion(saturday)).toBeLessThan(congestion(monday(8)));
    expect(congestion(sunday)).toBeLessThan(congestion(saturday));
  });

  it('moves smoothly between the hourly values', () => {
    const half = congestion(monday(7.5));
    expect(half).toBeGreaterThan(congestion(monday(7)));
    expect(half).toBeLessThan(congestion(monday(8)));
  });

  it('slows big roads more than small streets and big cities more than small ones', () => {
    const at = monday(18);
    expect(slowdownOf('motorway', at, 1)).toBeGreaterThan(slowdownOf('primary', at, 1));
    expect(slowdownOf('primary', at, 1)).toBeGreaterThan(slowdownOf('residential', at, 1));
    expect(slowdownOf('motorway', at, regionBusyness('34'))).toBeGreaterThan(slowdownOf('motorway', at, regionBusyness('75')));
    expect(slowdownOf('ferry', at, 1)).toBe(0);
    expect(slowdownOf('motorway', at, 100)).toBeLessThanOrEqual(0.75);
  });

  it('keeps the rush hour delay of a motorway near what was measured in Istanbul', () => {
    const slow = slowdownOf('motorway', monday(18), 1);
    expect(1 / (1 - slow) - 1).toBeGreaterThan(0.4);
    expect(1 / (1 - slow) - 1).toBeLessThan(0.7);
  });

  it('gives the map road kinds the same ordering', () => {
    const at = monday(18);
    expect(mapSlowdown('highway', at, 1)).toBeGreaterThan(mapSlowdown('major_road', at, 1));
    expect(mapSlowdown('major_road', at, 1)).toBeGreaterThan(mapSlowdown('minor_road', at, 1));
  });

  it('names the bands and rounds time to quarter hours', () => {
    expect(bandOf(0.05)).toBe('smooth');
    expect(bandOf(0.2)).toBe('busy');
    expect(bandOf(0.35)).toBe('heavy');
    expect(bandOf(0.6)).toBe('jam');
    expect(trafficBucket(monday(8) + 14 * 60_000)).toBe(monday(8));
    expect(trafficBucket(monday(8) + 15 * 60_000)).toBe(monday(8) + 900_000);
  });
});
