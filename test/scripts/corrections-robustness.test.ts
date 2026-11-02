import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeKey } from '../../src/core/learn/key';
import { parseArgs, runImport } from '../../scripts/corrections';

const KEY = { region: '34', district: 'kadikoy', neighbourhood: 'moda', street: 'gul~sokak', houseNumber: '20' };
const good = JSON.stringify({ v: 1, key: composeKey(KEY), region: '34', text: 't', confirmations: [{ source: 'pin', lng: 28.66, lat: 40.76, at: 1 }] });
const dir = (): string => mkdtempSync(join(tmpdir(), 'geo-corr2-'));
const args = (file: string, out: string, extra: object = {}) => ({ files: [file], approve: true, includeSingle: false, outDir: join(out, 'c'), reportDir: join(out, 'r'), date: '2026-10-24', ...extra });

describe('H14 corrections files', () => {
  it('never overwrite an earlier approved file of the same day', () => {
    const out = dir();
    const file = join(out, 'a.jsonl');
    writeFileSync(file, good + '\n');
    const first = runImport(args(file, out));
    const second = runImport(args(file, out));
    expect(first.correctionsPath).toBe(join(out, 'c', 'corrections-2026-10-24.jsonl'));
    expect(second.correctionsPath).toBe(join(out, 'c', 'corrections-2026-10-24-2.jsonl'));
    expect(readFileSync(first.correctionsPath as string, 'utf8')).toContain(composeKey(KEY));
  });

  it('write no file at all when nothing was accepted', () => {
    const out = dir();
    const file = join(out, 'a.jsonl');
    writeFileSync(file, '');
    const outcome = runImport(args(file, out));
    expect(outcome.correctionsPath).toBeNull();
    expect(existsSync(join(out, 'c'))).toBe(false);
  });

  it('read a file that starts with a byte order mark', () => {
    const out = dir();
    const file = join(out, 'a.jsonl');
    writeFileSync(file, '﻿' + good + '\n');
    expect(runImport(args(file, out, { approve: false })).accepted).toBe(1);
  });

  it('refuse a switch as the value of --out', () => {
    expect(parseArgs(['import', 'a', '--out', '--approve'])).toContain('--out');
  });
});
