export type Stats = { n: number; mean: number; median: number; p90: number };

const round1 = (value: number): number => Math.round(value * 10) / 10;

export function summarize(values: readonly number[]): Stats {
  if (values.length === 0) return { n: 0, mean: 0, median: 0, p90: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number): number => {
    const position = (sorted.length - 1) * q;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    return (sorted[low] as number) + ((sorted[high] as number) - (sorted[low] as number)) * (position - low);
  };
  return { n: values.length, mean: round1(values.reduce((s, v) => s + v, 0) / values.length), median: round1(at(0.5)), p90: round1(at(0.9)) };
}
