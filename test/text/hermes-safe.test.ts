import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findForbidden } from './helpers/forbidden';

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });

describe('findForbidden', () => {
  it.each([
    ['text.normalize("NFD")', 'normalize'],
    ['x.toLocaleLowerCase("tr")', 'toLocaleLowerCase'],
    ['x.toLocaleUpperCase()', 'toLocaleUpperCase'],
    ['x.toLowerCase()', 'toLowerCase'],
    ['x.toUpperCase()', 'toUpperCase'],
    ['new Intl.Collator("tr")', 'Intl'],
    ['/\\p{L}/u.test(x)', '\\p{'],
    ['/\\P{Lu}/u.test(x)', '\\P{'],
  ])('catches %s', (code, word) => {
    expect(findForbidden(code)).toContain(word);
  });

  it('lets ordinary code through', () => {
    expect(findForbidden('const normalized = fold(x); // normalizer')).toEqual([]);
    expect(findForbidden('const s = "p{" + "L}";')).toEqual([]);
  });
});

describe('src/core/text', () => {
  it('uses nothing Hermes could treat differently from Node', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src/core/text'))
      .map((file) => ({ file, found: findForbidden(readFileSync(file, 'utf8')) }))
      .filter((entry) => entry.found.length > 0);
    expect(offenders).toEqual([]);
  });
});
