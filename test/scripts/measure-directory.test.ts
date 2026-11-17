import { DOOR_SHARE_MIN, MEDIAN_MAX_M, MIN_PAIRS, P90_MAX_M, detailVerdict, pairVerdict } from '../../scripts/measure-directory';

const spread = (count: number, value: number): number[] => Array.from({ length: count }, () => value);

describe('pairVerdict', () => {
  it('passes when there are enough pairs and the distances are small', () => {
    expect(pairVerdict(spread(MIN_PAIRS, 10))).toMatchObject({ pass: true, median: 10, p90: 10 });
  });
  it('fails on too few pairs, however good they are', () => {
    expect(pairVerdict(spread(MIN_PAIRS - 1, 1)).pass).toBe(false);
    expect(pairVerdict([]).pass).toBe(false);
  });
  it('fails when the median is over the limit', () => {
    expect(pairVerdict(spread(MIN_PAIRS, MEDIAN_MAX_M + 1)).pass).toBe(false);
    expect(pairVerdict(spread(MIN_PAIRS, MEDIAN_MAX_M)).pass).toBe(true);
  });
  it('fails when the tail is over the limit', () => {
    const tail = [...spread(MIN_PAIRS * 0.8, 5), ...spread(MIN_PAIRS * 0.2, P90_MAX_M + 1)];
    expect(pairVerdict(tail)).toMatchObject({ pass: false, median: 5 });
  });
});

describe('detailVerdict', () => {
  it('passes when every place has details and enough have a door number', () => {
    expect(detailVerdict(200, 200, 100)).toEqual({ pass: DOOR_SHARE_MIN === 50, percent: 50 });
    expect(detailVerdict(200, 200, 140).pass).toBe(true);
  });
  it('fails when a place lacks its detail row', () => {
    expect(detailVerdict(200, 199, 200).pass).toBe(false);
  });
  it('fails when too few have a door number', () => {
    expect(detailVerdict(200, 200, 99).pass).toBe(false);
  });
  it('fails on an empty directory', () => {
    expect(detailVerdict(0, 0, 0)).toEqual({ pass: false, percent: 0 });
  });
});
