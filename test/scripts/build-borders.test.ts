import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBordersFile, writeBordersModule } from '../../scripts/build-borders';
import { createBorders } from '../../src/core/region/borders';

const ring = [[28.5, 40.5], [29.5, 40.5], [29.5, 41.5], [28.5, 41.5], [28.5, 40.5]];
const lines = [{ plate: '34', rings: [[ring]] }, { plate: '06', rings: [[[[32, 39.5], [33, 39.5], [33, 40.5], [32, 40.5], [32, 39.5]]]] }];

describe('buildBordersFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'borders-'));
  const input = join(dir, 'borders.jsonl');
  writeFileSync(input, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  it('writes a file the reader understands and reports its size', () => {
    const out = join(dir, 'borders.bin');
    const result = buildBordersFile(input, out);
    expect(result.bytes).toBe(readFileSync(out).length);
    expect(result.provinces).toBe(2);
    expect(createBorders(readFileSync(out)).provinceAt(29, 41)).toBe('34');
  });

  it('writes the same bytes twice', () => {
    buildBordersFile(input, join(dir, 'a.bin'));
    buildBordersFile(input, join(dir, 'b.bin'));
    expect(readFileSync(join(dir, 'a.bin'))).toEqual(readFileSync(join(dir, 'b.bin')));
  });

  it('refuses an input with a broken line', () => {
    writeFileSync(join(dir, 'bad.jsonl'), '{"plate":\n');
    expect(() => buildBordersFile(join(dir, 'bad.jsonl'), join(dir, 'x.bin'))).toThrow(/bad\.jsonl:1/);
  });
});

describe('writeBordersModule', () => {
  const dir = mkdtempSync(join(tmpdir(), 'borders-module-'));
  const input = join(dir, 'borders.jsonl');
  writeFileSync(input, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  it('writes a TypeScript module whose text decodes to the same bytes', () => {
    const bin = join(dir, 'borders.bin');
    buildBordersFile(input, bin);
    const out = join(dir, 'borders-base64.ts');
    const result = writeBordersModule(bin, out);
    const source = readFileSync(out, 'utf8');
    const match = /^export const BORDERS_BASE64 = '([A-Za-z0-9+/=]+)';\n$/.exec(source);
    expect(match).not.toBeNull();
    expect(new Uint8Array(Buffer.from(match?.[1] ?? '', 'base64'))).toEqual(new Uint8Array(readFileSync(bin)));
    expect(result.bytes).toBe(readFileSync(bin).length);
  });

  it('writes the same text twice and leaves no temporary file', () => {
    const bin = join(dir, 'borders.bin');
    writeBordersModule(bin, join(dir, 'a.ts'));
    writeBordersModule(bin, join(dir, 'b.ts'));
    expect(readFileSync(join(dir, 'a.ts'), 'utf8')).toBe(readFileSync(join(dir, 'b.ts'), 'utf8'));
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
