import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestProblems, personalHits, readJsonDir, SET_NAMES } from '../../gates/adres-0';
import { parseAdresArg } from '../../gates/cli';

describe('personalHits', () => {
  it('finds phone numbers, e-mails and identity numbers', () => {
    expect(personalHits([{ text: 'Gül Sk. No:12 0532 123 45 67' }])).toEqual(['telefon']);
    expect(personalHits([{ text: 'Gül Sk. 12', note: 'ayse@example.com' }])).toEqual(['e-posta']);
    expect(personalHits([{ text: 'Gül Sk. 12 tc 12345678901' }])).toEqual(['kimlik no']);
  });

  it('leaves ordinary addresses alone', () => {
    expect(personalHits([{ text: 'Fethiye Mah. 1203/1 Sk. No:12/7 Kat 3 Daire 7 16140 Nilüfer/Bursa' }, { text: 'Atatürk Cd. No:150' }])).toEqual([]);
  });
});

describe('readJsonDir', () => {
  it('reads every list file and skips broken ones', () => {
    const dir = mkdtempSync(join(tmpdir(), 'adres-gate-'));
    writeFileSync(join(dir, 'a.json'), JSON.stringify([{ id: '1' }, { id: '2' }]));
    writeFileSync(join(dir, 'b.json'), '{');
    writeFileSync(join(dir, 'c.json'), JSON.stringify({ id: '3' }));
    writeFileSync(join(dir, 'd.txt'), JSON.stringify([{ id: '4' }]));
    expect(readJsonDir<{ id: string }>(dir).map((r) => r.id)).toEqual(['1', '2']);
    expect(readJsonDir(join(dir, 'yok'))).toEqual([]);
  });
});

describe('manifestProblems', () => {
  const setup = (plates: number, tamper = false): string => {
    const root = mkdtempSync(join(tmpdir(), 'adres-manifest-'));
    const manifest: Record<string, unknown> = {};
    for (const name of SET_NAMES) {
      const files: Record<string, string> = {};
      for (let i = 1; i <= plates; i++) {
        const plate = String(i).padStart(2, '0');
        const text = JSON.stringify([{ plate, name }]);
        const dir = join(root, 'dist', 'addr-eval', 'v1', name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${plate}.json`), tamper && plate === '01' ? `${text} ` : text);
        files[plate] = createHash('sha256').update(text).digest('hex');
      }
      manifest[name] = { data: 'v1', files };
    }
    mkdirSync(join(root, 'fixtures', 'addr-eval'), { recursive: true });
    writeFileSync(join(root, 'fixtures', 'addr-eval', 'MANIFEST.json'), JSON.stringify(manifest));
    return root;
  };

  it('passes when every set covers 81 provinces with matching hashes', () => {
    expect(manifestProblems(setup(81))).toEqual([]);
  });

  it('reports missing provinces and changed files', () => {
    expect(manifestProblems(setup(3))).toEqual(SET_NAMES.map((name) => `${name}: 3 il`));
    expect(manifestProblems(setup(81, true))).toEqual(SET_NAMES.map((name) => `${name}/01 özeti tutmuyor`));
  });

  it('reports a missing manifest', () => {
    expect(manifestProblems(mkdtempSync(join(tmpdir(), 'adres-empty-')))).toEqual(['MANIFEST.json yok']);
  });
});

describe('parseAdresArg', () => {
  it('reads the address phase number', () => {
    expect(parseAdresArg(['--adres', '0'])).toBe(0);
    expect(parseAdresArg(['--adres', '16A'])).toBe(16.5);
    expect(parseAdresArg(['--adres', '3a'])).toBe(3.5);
    expect(parseAdresArg(['--adres', '16B'])).toBe(16.6);
    expect(parseAdresArg(['--adres', 'x'])).toBeNull();
    expect(parseAdresArg(['--phase', '3'])).toBeNull();
  });
});
