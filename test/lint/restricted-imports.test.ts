import { spawnSync } from 'node:child_process';

type Message = { ruleId: string | null };

const lint = (code: string, filePath: string): Message[] => {
  const run = spawnSync('npx', ['eslint', '--stdin', '--stdin-filename', filePath, '--format', 'json'], {
    input: code,
    encoding: 'utf8',
    cwd: process.cwd(),
  });
  const parsed = JSON.parse(run.stdout) as { messages: Message[] }[];
  return parsed[0]?.messages ?? [];
};

describe('src/core import restrictions', () => {
  it('rejects node built-ins in core', () => {
    const messages = lint("import fs from 'node:fs';\nexport const x = fs;\n", 'src/core/x.ts');
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('rejects react-native in core', () => {
    const messages = lint("import { View } from 'react-native';\nexport const x = View;\n", 'src/core/x.ts');
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('allows the same imports outside core', () => {
    const messages = lint("import { View } from 'react-native';\nexport const x = View;\n", 'src/native/x.ts');
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });
});

describe('src/core/text syntax restrictions', () => {
  const ruleIds = (code: string, file: string) => lint(code, file).map((m) => m.ruleId);

  it.each([
    'export const a = (x: string) => x.normalize("NFD");',
    'export const a = (x: string) => x.toLocaleLowerCase("tr");',
    'export const a = (x: string) => x.toLowerCase();',
    'export const a = new Intl.Collator("tr");',
    'export const a = /\\p{L}/u;',
  ])('rejects %s in text', (code) => {
    expect(ruleIds(code, 'src/core/text/x.ts')).toContain('no-restricted-syntax');
  });

  it('allows the same code elsewhere in core', () => {
    expect(ruleIds('export const a = (x: string) => x.toLowerCase();', 'src/core/report/x.ts')).not.toContain('no-restricted-syntax');
  });
});

describe('address and geo folders and classes', () => {
  const ruleIds = (code: string, file: string) => lint(code, file).map((m) => m.ruleId);

  it.each(['src/core/address/x.ts', 'src/core/geo/x.ts'])('apply the Hermes syntax rules in %s', (file) => {
    expect(ruleIds('export const a = (x: string) => x.toLowerCase();', file)).toContain('no-restricted-syntax');
    expect(ruleIds('export const a = (x: string) => x.normalize("NFD");', file)).toContain('no-restricted-syntax');
  });

  it.each(['src/core/region/x.ts', 'src/core/address/x.ts', 'src/core/geo/x.ts', 'src/core/text/x.ts'])('refuse a class in %s', (file) => {
    expect(ruleIds('export class A {}', file)).toContain('no-restricted-syntax');
    expect(ruleIds('export const B = class {};', file)).toContain('no-restricted-syntax');
  });

  it('allow a class outside core', () => {
    expect(ruleIds('export class A {}', 'src/node/x.ts')).not.toContain('no-restricted-syntax');
  });
});
