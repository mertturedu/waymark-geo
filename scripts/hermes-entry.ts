import golden from '../fixtures/text-golden.json';
import unicode from '../fixtures/text-unicode.json';
import { foldText, nameKey } from '../src/core/text/fold';
import { runGolden, type GoldenCase } from '../test/text/helpers/golden';

declare const print: ((text: string) => void) | undefined;

const result = runGolden(golden.cases as unknown as GoldenCase[]);
const differences = (unicode.cases as [string, string, string][]).filter(([text, fold, key]) => foldText(text) !== fold || nameKey(text) !== key).map(([text]) => text);
const text = JSON.stringify({
  total: result.total,
  failed: result.failed.length,
  failures: result.failed.slice(0, 20),
  unicode: { checked: unicode.cases.length, differences },
  runtime: 'hermes',
});
if (typeof print === 'function') print(text);
else console.log(text);
