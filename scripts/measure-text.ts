import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { goldenResult, measureFuzz, measureK15, measureSpeed } from '../test/text/helpers/measure';
import type { GoldenFile } from '../test/text/helpers/golden';
import type { AddressRecord } from './build-address-records';

export type Check = 'golden' | 'speed' | 'fuzz' | 'k15';
export type Outcome = { check: Check; pass: boolean; measured: string; detail: unknown };

export const THRESHOLDS = { speedP99Ms: 2, speedMaxMs: 50, k15: 0.98, fuzzCount: 100_000, k15Count: 5000, k15Seed: 2026 };

const load = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export function runCheck(check: Check, options: { fuzzCount?: number; k15Seed?: number } = {}): Outcome {
  if (check === 'golden') {
    const golden = load<GoldenFile>('fixtures/text-golden.json');
    const result = goldenResult(golden.cases);
    return { check, pass: result.failed.length === 0 && result.total >= 1500, measured: `${result.total - result.failed.length}/${result.total}`, detail: result.failed };
  }
  if (check === 'speed') {
    const golden = load<GoldenFile>('fixtures/text-golden.json');
    const speed = measureSpeed(golden.cases.map((c) => c.text), 20_000);
    const pass = speed.p99 < THRESHOLDS.speedP99Ms && speed.max < THRESHOLDS.speedMaxMs && speed.first < THRESHOLDS.speedMaxMs;
    return { check, pass, measured: `p99 ${speed.p99.toFixed(3)} ms, en uzun ${speed.max.toFixed(2)} ms, ilk çağrı ${speed.first.toFixed(2)} ms`, detail: speed };
  }
  if (check === 'fuzz') {
    const fuzz = measureFuzz(options.fuzzCount ?? THRESHOLDS.fuzzCount, 7);
    return { check, pass: fuzz.errors.length === 0 && fuzz.badShape.length === 0, measured: `${fuzz.count} girdi, ${fuzz.errors.length} hata, ${fuzz.badShape.length} bozuk sonuç`, detail: fuzz };
  }
  const { records } = load<{ records: AddressRecord[] }>('fixtures/address-records.json');
  const k15 = measureK15(records, THRESHOLDS.k15Count, options.k15Seed ?? THRESHOLDS.k15Seed);
  return { check, pass: k15.rate >= THRESHOLDS.k15, measured: `${(100 * k15.rate).toFixed(2)}% (${k15.ok}/${k15.total})`, detail: k15 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = process.argv[at + 1] as Check | undefined;
  if (at < 0 || !check || !['golden', 'speed', 'fuzz', 'k15'].includes(check)) {
    console.error('usage: tsx scripts/measure-text.ts --check golden|speed|fuzz|k15');
    process.exit(2);
  }
  const outcome = runCheck(check);
  console.log(JSON.stringify({ check: outcome.check, pass: outcome.pass, measured: outcome.measured }));
  if (process.argv.includes('--detail')) console.log(JSON.stringify(outcome.detail, null, 1));
  process.exit(outcome.pass ? 0 : 1);
}
