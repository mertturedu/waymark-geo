import { summarize } from './metrics';

describe('summarize', () => {
  it('says zero for nothing', () => {
    expect(summarize([])).toEqual({ n: 0, mean: 0, median: 0, p90: 0 });
  });

  it('handles a single value', () => {
    expect(summarize([7.26])).toEqual({ n: 1, mean: 7.3, median: 7.3, p90: 7.3 });
  });

  it('takes the middle and interpolates the ninetieth percentile', () => {
    expect(summarize([5, 1, 3])).toEqual({ n: 3, mean: 3, median: 3, p90: 4.6 });
    expect(summarize([1, 2, 3, 4])).toMatchObject({ median: 2.5, p90: 3.7 });
    expect(summarize(Array.from({ length: 11 }, (_, i) => i * 10))).toMatchObject({ median: 50, p90: 90, mean: 50 });
  });

  it('does not reorder the input', () => {
    const input = [3, 1, 2];
    summarize(input);
    expect(input).toEqual([3, 1, 2]);
  });
});
