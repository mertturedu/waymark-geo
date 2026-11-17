import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { solveHeuristic } from '../src/core/plan/heuristic';
import { costOf, type Problem } from '../src/core/plan/problem';
import { repoRoot } from './measure-address';

type Instance = { id: number; size: number; hasStart: boolean; end: 'free' | 'return'; matrix: number[][]; pins: { node: number; position: number }[]; precedence: [number, number][] };

const dir = join(repoRoot, 'dist', 'work', 'plan');
const instances = JSON.parse(readFileSync(join(dir, 'instances.json'), 'utf8')) as Instance[];
const reference = JSON.parse(readFileSync(join(dir, 'ortools.json'), 'utf8')) as { id: number; cost: number | null }[];

const problemOf = (i: Instance): Problem => {
  const base = i.hasStart ? 1 : 0;
  const cell = (a: number, b: number): number => (i.matrix[a] as number[])[b] as number;
  const order = Array.from({ length: i.size }, (_, k) => k).sort((a, b) => (`d${a}` < `d${b}` ? -1 : 1));
  const rank = new Map(order.map((original, k) => [original, k]));
  return {
    size: i.size,
    from: order.map((o) => (i.hasStart ? cell(0, o + 1) : 0)),
    between: order.map((a) => order.map((b) => cell(a + base, b + base))),
    back: i.hasStart && i.end === 'return' ? order.map((o) => cell(o + base, 0)) : null,
    rules: { size: i.size, pins: new Map(i.pins.map((p) => [rank.get(p.node) as number, p.position])), before: i.precedence.map(([a, b]) => [rank.get(a) as number, rank.get(b) as number] as [number, number]) },
  };
};

const scale = Number(process.argv[2] ?? 1);
const gaps: number[] = [];
const bad: string[] = [];
let slowest = 0;
const only = process.argv[3] ? new Set(process.argv[3].split(',').map(Number)) : null;
for (const instance of instances) {
  if (only && !only.has(instance.id)) continue;
  const theirs = reference.find((r) => r.id === instance.id)?.cost;
  if (!theirs) continue;
  const ms = (instance.size <= 50 ? 800 : 2500) * scale;
  const started = performance.now();
  const order = solveHeuristic(problemOf(instance), { now: () => performance.now(), ms, seed: 20261030 });
  slowest = Math.max(slowest, performance.now() - started);
  if (!order) continue;
  const mine = costOf(problemOf(instance), order);
  const gap = ((mine - theirs) / theirs) * 100;
  gaps.push(gap);
  if (gap > 3) bad.push(`#${instance.id} ${instance.size} durak, ${instance.precedence.length} çift: %${gap.toFixed(1)}`);
}
const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
console.log(JSON.stringify({ n: gaps.length, mean: Number(mean.toFixed(2)), worst: Number(Math.max(...gaps).toFixed(2)), better: gaps.filter((g) => g < 0).length, slowestMs: Math.round(slowest), over3: bad.length }));
for (const line of bad.slice(0, 8)) console.log(line);
