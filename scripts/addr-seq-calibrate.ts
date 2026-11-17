import { pathToFileURL } from 'node:url';
import { recordMeasure } from '../tools/compare/measures';
import { DEFAULT_RADIUS, radiusFor } from '../src/core/address/sequence';
import { evaluate, type Sample } from './addr-seq-eval';

export const BINS = [2, 4, 8, 16, 32, Number.POSITIVE_INFINITY];

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

const binOf = (delta: number): number => BINS.findIndex((limit) => delta <= limit);

export function table(train: Sample[], q: number): number[][] {
  return [1, 2].map((tier) => BINS.map((_, b) => {
    const rows = train.filter((s) => (tier === 1 ? s.k === 1 : s.k !== 1) && binOf(s.delta) === b);
    return rows.length < 8 ? 0 : Math.round(quantile(rows.map((s) => s.errorM), q) * 10) / 10;
  }));
}

async function main(): Promise<void> {
  const plates = (process.argv[2] ?? '06,35,16,41').split(',');
  const pack = process.env.BUILD_NAME ?? 's5a';
  const all: Sample[] = [];
  for (const plate of plates) all.push(...(await evaluate(plate, pack, 'A', 4)));
  const train = all.filter((s) => !s.bracket && s.street % 4 === 1);
  const test = all.filter((s) => !s.bracket && s.street % 4 === 3);
  const t = table(train, 0.9);
  console.log('eğitim', train.length, 'sınama', test.length);
  console.log('p90 tablosu (satır: 1 çapa, ≥2 çapa; sütun: Δ≤2,4,8,16,32,>32)', JSON.stringify(t));
  let hit = 0;
  for (const s of test) if (s.errorM <= radiusFor(DEFAULT_RADIUS, s.delta, s.k === 1 ? 1 : 2)) hit++;
  const coverage = Number((100 * hit / test.length).toFixed(1));
  console.log('sınama kapsama', coverage);
  if (process.argv.includes('--record')) recordMeasure('a6_calibration', { plates, train: train.length, test: test.length, coverage });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
