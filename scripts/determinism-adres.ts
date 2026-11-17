import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordMeasure } from '../tools/compare/measures';
import { runAddressDeterminism } from './determinism-run';
import type { Sources } from './fetch-sources';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function main(): Promise<void> {
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as Sources;
  const started = Date.now();
  const result = await runAddressDeterminism(sources, (line) => console.error(line));
  const seconds = Math.round((Date.now() - started) / 1000);
  const same = result.differing.length === 0 && result.onlyA.length === 0 && result.onlyB.length === 0 && result.compared > 0;
  recordMeasure('a12_determinism', { compared: result.compared, equal: result.equal, differing: result.differing.slice(0, 20), onlyA: result.onlyA.slice(0, 20), onlyB: result.onlyB.slice(0, 20), seconds, same });
  console.log(`${result.equal}/${result.compared} dosya bayt bayt aynı, ${seconds} sn${same ? '' : ` (farklı: ${result.differing.slice(0, 5).join(', ')})`}`);
  process.exit(same ? 0 : 1);
}

void main();
