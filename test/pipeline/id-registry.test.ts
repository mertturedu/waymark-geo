import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignId, loadRegistry, saveRegistry } from '../../pipeline/build/id-registry';

const dir = (): string => mkdtempSync(join(tmpdir(), 'ids-'));

describe('id registry', () => {
  it('aynı anahtara aynı kimliği verir, kaydı ekleyerek saklar', () => {
    const where = dir();
    const first = loadRegistry(where, '99');
    const a = assignId(first, new Set(), 'ataturk|cadde', ['w1', 'w2'], () => 'S99-aaa');
    saveRegistry(where, '99', first);
    const second = loadRegistry(where, '99');
    expect(assignId(second, new Set(), 'ataturk|cadde', ['w1'], () => 'S99-zzz')).toBe(a);
    expect(second.fresh).toHaveLength(0);
  });

  it('adı değişen ama yol parçaları aynı kalan sokağın kimliğini korur', () => {
    const where = dir();
    const first = loadRegistry(where, '99');
    assignId(first, new Set(), 'ataturk|cadde', ['w1', 'w2', 'w3'], () => 'S99-aaa');
    saveRegistry(where, '99', first);
    const second = loadRegistry(where, '99');
    const sid = assignId(second, new Set(), 'cumhuriyet|cadde', ['w1', 'w2', 'w3'], () => 'S99-new');
    expect(sid).toBe('S99-aaa');
    expect(second.renamed).toEqual([{ from: 'ataturk|cadde', to: 'cumhuriyet|cadde', sid: 'S99-aaa' }]);
  });

  it('iki sokak aynı kimliği paylaşmaz ve ortak parçası yetersizse yeni kimlik alır', () => {
    const where = dir();
    const reg = loadRegistry(where, '99');
    const claimed = new Set<string>();
    const a = assignId(reg, claimed, 'a|sokak', ['w1', 'w2'], () => 'S99-a');
    const b = assignId(reg, claimed, 'b|sokak', ['w1', 'w9'], () => 'S99-b');
    expect(a).toBe('S99-a');
    expect(b).toBe('S99-b');
    const c = assignId(reg, claimed, 'c|sokak', ['w5'], () => 'S99-c');
    expect(c).toBe('S99-c');
  });
});
