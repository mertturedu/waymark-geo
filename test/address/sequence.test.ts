import type { BuildingInfo } from '../../src/core/address/buildings2';
import { increasesAlong, predictFromBuildings, radiusFor, type Anchor } from '../../src/core/address/sequence';

let nextId = 1;
const building = (side: 'left' | 'right', index: number, spacing = 12): BuildingInfo => {
  const along = index * spacing;
  return { id: nextId++, gid: `g${nextId}`, center: [29 + along / 111_320 / 0.754, 41 + (side === 'left' ? 0.0001 : -0.0001)], areaM2: 120, levels: 3, levelsSource: 'region', heightM: null, name: null, chain: 7, part: 0, side, distanceM: 10, along, sequence: index + 1, secondChain: null, thirdChain: null, ring: [] };
};

const street = (count = 20): BuildingInfo[] => [...Array.from({ length: count }, (_, i) => building('left', i)), ...Array.from({ length: count }, (_, i) => building('right', i))];
const anchorAt = (b: BuildingInfo, number: number, weight = 1): Anchor => ({ number, point: b.center, weight });

describe('increasesAlong', () => {
  it('follows the rule that odd numbers stand on the left while numbers rise', () => {
    expect(increasesAlong(1, 'left')).toBe(1);
    expect(increasesAlong(1, 'right')).toBe(-1);
    expect(increasesAlong(0, 'right')).toBe(1);
    expect(increasesAlong(0, 'left')).toBe(-1);
  });
});

describe('predictFromBuildings', () => {
  const buildings = street();
  const left = buildings.filter((b) => b.side === 'left');
  const right = buildings.filter((b) => b.side === 'right');

  it('walks along the street from a single anchor: two numbers per building', () => {
    const result = predictFromBuildings({ number: 11, anchors: [anchorAt(left[2] as BuildingInfo, 5)], buildings });
    expect(result?.building.id).toBe((left[5] as BuildingInfo).id);
  });

  it('puts an even number on the other side, level with its odd neighbour', () => {
    const result = predictFromBuildings({ number: 6, anchors: [anchorAt(left[2] as BuildingInfo, 5)], buildings });
    expect(result?.building.side).toBe('right');
    expect(result?.building.along).toBe(36);
  });

  it('interpolates between two anchors and learns the spacing from them', () => {
    const result = predictFromBuildings({ number: 9, anchors: [anchorAt(left[0] as BuildingInfo, 1), anchorAt(left[8] as BuildingInfo, 17)], buildings });
    expect(result?.building.id).toBe((left[4] as BuildingInfo).id);
    expect(result?.anchors).toBe(2);
  });

  it('goes the other way for an odd number on the right', () => {
    const result = predictFromBuildings({ number: 3, anchors: [anchorAt(right[8] as BuildingInfo, 9)], buildings: buildings.map((b) => (b.side === 'right' ? b : b)) });
    expect(result?.building.along).toBe(96 + 36);
  });

  it('ignores an anchor that disagrees with the rest when there are enough', () => {
    const anchors = [anchorAt(left[1] as BuildingInfo, 3), anchorAt(left[2] as BuildingInfo, 5), anchorAt(left[3] as BuildingInfo, 7), anchorAt(left[18] as BuildingInfo, 9)];
    const result = predictFromBuildings({ number: 11, anchors, buildings });
    expect(result?.anchors).toBe(3);
    expect(result?.building.id).toBe((left[5] as BuildingInfo).id);
  });

  it('says so when the number lies far beyond the last building and clamps to the end', () => {
    const result = predictFromBuildings({ number: 199, anchors: [anchorAt(left[2] as BuildingInfo, 5)], buildings });
    expect(result?.notes).toContain('number_out_of_range');
    expect(result?.building.id).toBe((left[19] as BuildingInfo).id);
  });

  it('widens the radius with the distance in numbers and with fewer anchors', () => {
    const one = predictFromBuildings({ number: 15, anchors: [anchorAt(left[2] as BuildingInfo, 5)], buildings });
    const near = predictFromBuildings({ number: 7, anchors: [anchorAt(left[2] as BuildingInfo, 5)], buildings });
    expect((one?.radiusM as number) > (near?.radiusM as number)).toBe(true);
    const custom = predictFromBuildings({ number: 7, anchors: [anchorAt(left[2] as BuildingInfo, 5)], buildings }, { radius: { bins: [4, Number.POSITIVE_INFINITY], one: [10, 20], many: [5, 8] } });
    expect(custom?.radiusM).toBe(10);
    expect(radiusFor({ bins: [4, Number.POSITIVE_INFINITY], one: [10, 20], many: [5, 8] }, 50, 3)).toBe(8);
  });

  it('gives nothing without buildings, tracks or an anchor on the street', () => {
    expect(predictFromBuildings({ number: 5, anchors: [], buildings })).toBeNull();
    expect(predictFromBuildings({ number: 5, anchors: [anchorAt(left[1] as BuildingInfo, 3)], buildings: [] })).toBeNull();
    expect(predictFromBuildings({ number: 5, anchors: [{ number: 3, point: [30, 42], weight: 1 }], buildings })).toBeNull();
  });
});
