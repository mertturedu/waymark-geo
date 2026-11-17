import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heuristicRuns, scenarioResults } from './scenarios';

const expected = JSON.parse(readFileSync(join(__dirname, 'expected.json'), 'utf8')) as { heuristic: unknown[]; plans: unknown[] };

describe('recorded behaviour', () => {
  it('heuristic orders stay as recorded', () => {
    expect(heuristicRuns()).toEqual(expected.heuristic);
  });

  it('plans stay as recorded', async () => {
    expect(await scenarioResults()).toEqual(expected.plans);
  });
});
