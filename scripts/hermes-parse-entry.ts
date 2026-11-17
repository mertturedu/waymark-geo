import fixture from '../fixtures/parse-v2.json';
import { parseAddress } from '../src/core/text/parse';
import { summaryOf } from '../src/core/text/summary';

declare const print: ((text: string) => void) | undefined;

type Case = { id: string; text: string; expect: unknown };
const cases = fixture.cases as unknown as Case[];
const clock: () => number = typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now();
const times: number[] = [];
const different: string[] = [];
for (const c of cases) parseAddress(c.text);
for (const c of cases) {
  const started = clock();
  const parsed = parseAddress(c.text);
  times.push(clock() - started);
  if (JSON.stringify(summaryOf(parsed)) !== JSON.stringify(c.expect)) different.push(c.id);
}
times.sort((a, b) => a - b);
const text = JSON.stringify({ total: cases.length, different: different.length, ids: different.slice(0, 10), p50: times[Math.floor(times.length * 0.5)], p95: times[Math.floor(times.length * 0.95)], max: times[times.length - 1], runtime: 'hermes' });
if (typeof print === 'function') print(text);
else console.log(text);
