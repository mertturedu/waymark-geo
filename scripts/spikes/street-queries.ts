export type StreetQuery = { q: string; name: string; typo: boolean };
export type Sample = { ms: number; firstOk: boolean; topFiveOk: boolean };
export type Summary = { count: number; p50: number; p95: number; p99: number; firstPercent: number; topFivePercent: number };

const TYPO_SHARE = 0.2;

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const typoEligible = (name: string): boolean => name.length > 5 && !/\d/.test(name);

export function makeQueries(names: string[], seed: number, count: number): StreetQuery[] {
  if (names.length === 0) return [];
  const next = rng(seed);
  const out: StreetQuery[] = [];
  for (let i = 0; i < count; i++) {
    const name = names[Math.floor(next() * names.length)] as string;
    if (typoEligible(name) && next() < TYPO_SHARE) {
      const at = 1 + Math.floor(next() * (name.length - 1));
      out.push({ q: name.slice(0, at) + name.slice(at + 1), name, typo: true });
    } else {
      out.push({ q: name, name, typo: false });
    }
  }
  return out;
}

export function summarise(samples: Sample[]): Summary {
  const n = samples.length;
  if (n === 0) return { count: 0, p50: 0, p95: 0, p99: 0, firstPercent: 0, topFivePercent: 0 };
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const at = (p: number): number => sorted[Math.min(n - 1, Math.floor(p * n))] as number;
  return {
    count: n,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    firstPercent: Math.round((100 * samples.filter((s) => s.firstOk).length) / n),
    topFivePercent: Math.round((100 * samples.filter((s) => s.topFiveOk).length) / n),
  };
}

export function streetVerdict(summary: Summary, limitMs: number, minFirstPercent: number): 'pass' | 'fail' {
  return summary.p95 <= limitMs && summary.firstPercent >= minFirstPercent ? 'pass' : 'fail';
}
