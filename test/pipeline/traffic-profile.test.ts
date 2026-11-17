import { createProfileBuilder, parseSpeedRow, PROFILE_OPTIONS, type SpeedRow } from '../../pipeline/build/traffic-profile';

const row = (slot: number, speed: number, vehicles = 20, cell = 'sxk9u3'): SpeedRow => ({ month: '2024-10', cell, slot, speed, vehicles });
const options = { ...PROFILE_OPTIONS, minRows: 10 };

describe('traffic profile from hourly speed rows', () => {
  it('reads a row with its local hour and day kind', () => {
    expect(parseSpeedRow('"2024-10-01 18:00:00","41.04","28.92",sxk96p,6,59,33,25')).toEqual({ month: '2024-10', cell: 'sxk96p', slot: 18, speed: 33, vehicles: 25 });
    expect(parseSpeedRow('"2024-10-05 07:00:00","41.04","28.92",sxk96p,6,59,40,8')?.slot).toBe(24 + 7);
    expect(parseSpeedRow('"2024-10-06 23:00:00","41.04","28.92",sxk96p,6,59,40,8')?.slot).toBe(48 + 23);
    expect(parseSpeedRow('\u{FEFF}"2025-01-01 00:00:00","41.15","28.88",sxkd1k,58,107,79,11')?.month).toBe('2025-01');
  });

  it('skips lines that are not rows', () => {
    expect(parseSpeedRow('')).toBeNull();
    expect(parseSpeedRow('"DATE_TIME","LATITUDE","LONGITUDE","GEOHASH","MINIMUM_SPEED","MAXIMUM_SPEED","AVERAGE_SPEED","NUMBER_OF_VEHICLES"')).toBeNull();
  });

  it('measures the slowdown of an hour against the night speed of the cell', () => {
    const builder = createProfileBuilder(options);
    for (let i = 0; i < 20; i++) builder.add(row(3, 80));
    for (let i = 0; i < 5; i++) builder.add(row(18, 40));
    const table = builder.tables().get('sxk9u3');
    expect(table?.free).toBe(80);
    expect(table?.slowdowns[18]).toBeCloseTo(0.5, 6);
    expect(table?.slowdowns[3]).toBe(0);
    expect(table?.slowdowns[10]).toBeNull();
  });

  it('ignores hours with few vehicles and cells with few rows or crawling speeds', () => {
    const builder = createProfileBuilder(options);
    for (let i = 0; i < 20; i++) builder.add(row(3, 80, 4));
    for (let i = 0; i < 5; i++) builder.add(row(3, 80, 20, 'sxk9u4'));
    for (let i = 0; i < 20; i++) builder.add(row(3, 10, 20, 'sxk9u5'));
    expect(builder.tables().size).toBe(0);
  });

  it('leaves an hour with too few rows empty in the written profile', () => {
    const builder = createProfileBuilder(options);
    for (let i = 0; i < 20; i++) builder.add(row(3, 80));
    builder.add(row(18, 40));
    const text = builder.profile().cells.sxk9u3 as string;
    expect(text).toHaveLength(72);
    expect(text[3]).toBe('0');
    expect(text[18]).toBe('-');
  });
});
