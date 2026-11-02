import type { Rules } from './rules';

export type Problem = {
  size: number;
  from: ReadonlyArray<number>;
  between: ReadonlyArray<ReadonlyArray<number>>;
  back: ReadonlyArray<number> | null;
  rules: Rules;
};

export function costOf(problem: Problem, sequence: ReadonlyArray<number>): number {
  if (sequence.length === 0) return 0;
  let total = problem.from[sequence[0] as number] as number;
  for (let i = 1; i < sequence.length; i++) total += (problem.between[sequence[i - 1] as number] as ReadonlyArray<number>)[sequence[i] as number] as number;
  if (problem.back) total += problem.back[sequence[sequence.length - 1] as number] as number;
  return total;
}
