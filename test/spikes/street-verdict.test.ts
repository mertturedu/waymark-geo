import { streetVerdict } from '../../scripts/spikes/street-queries';

const summary = (p95: number, firstPercent: number) => ({ count: 500, p50: 10, p95, p99: p95, firstPercent, topFivePercent: 100 });

describe('streetVerdict', () => {
  it('passes when fast enough and the right street comes first often enough', () => {
    expect(streetVerdict(summary(76, 98), 150, 90)).toBe('pass');
  });

  it('fails a slow search', () => {
    expect(streetVerdict(summary(151, 98), 150, 90)).toBe('fail');
  });

  it('fails a fast search that finds nothing', () => {
    expect(streetVerdict(summary(5, 0), 150, 90)).toBe('fail');
    expect(streetVerdict(summary(5, 89), 150, 90)).toBe('fail');
  });

  it('accepts the limits exactly', () => {
    expect(streetVerdict(summary(150, 90), 150, 90)).toBe('pass');
  });
});
