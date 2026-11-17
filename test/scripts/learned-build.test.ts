import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditLearned } from '../../pipeline/validate/learned-audit';
import type { DeliveryRecord } from '../../pipeline/real/records';
import { buildProvince, recordFiles } from '../../scripts/learned-build';
import { builtPack } from '../address/helpers/search-fixture';

const record = (src: string, over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({ v: 1, src, week: 2800, region: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '20', coordSource: 'gps', gps: { lng: 28.66, lat: 40.76, accuracyM: 8 }, ...over });

describe('learned-build', () => {
  it('builds a province part from the packs of a work folder and passes the audit', async () => {
    const packs = mkdtempSync(join(tmpdir(), 'learned-build-'));
    mkdirSync(join(packs, '34'));
    copyFileSync(await builtPack(), join(packs, '34', 'address.sqlite'));
    const stats = await buildProvince('34', [record('a'), record('b'), record('c', { street: 'gül sk', houseNumber: '21' }), record('a', { street: 'Hiç Yok Sokak' })], packs, 2800);
    expect(stats).toMatchObject({ keys: 3, renamed: 1, unresolved: 1 });
    expect(auditLearned(join(packs, '34', 'learned.sqlite'), '34').errors).toEqual([]);
  });

  it('complains when the province has no address pack', async () => {
    const packs = mkdtempSync(join(tmpdir(), 'learned-build-'));
    await expect(buildProvince('34', [record('a')], packs, 2800)).rejects.toThrow(/adres paketi yok/);
  });
});

describe('recordFiles', () => {
  it('finds jsonl files in week folders and takes a single file as it is', () => {
    const root = mkdtempSync(join(tmpdir(), 'records-'));
    mkdirSync(join(root, '2026-11-02'));
    writeFileSync(join(root, '2026-11-02', 'records.jsonl'), '');
    writeFileSync(join(root, 'notes.txt'), '');
    expect(recordFiles(root)).toEqual([join(root, '2026-11-02', 'records.jsonl')]);
    expect(recordFiles(join(root, 'notes.txt'))).toEqual([join(root, 'notes.txt')]);
    expect(recordFiles(join(root, 'yok'))).toEqual([]);
  });
});
