import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildSteps } from '../../pipeline/build/orchestrate';
import { compareTrees, isComparable, stepsToRepeat } from '../../scripts/determinism-run';

const tree = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'tree-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
};

describe('compareTrees', () => {
  it('counts equal files and names the ones that differ or exist on one side only', async () => {
    const a = tree({ 'x/one.txt': '1', 'x/two.txt': '2', 'only-a.txt': 'a', '.markers/m.json': 'k' });
    const b = tree({ 'x/one.txt': '1', 'x/two.txt': 'DİFFERENT', 'only-b.txt': 'b', '.markers/m.json': 'other' });
    const result = await compareTrees(a, b);
    expect(result).toEqual({ compared: 2, equal: 1, differing: ['x/two.txt'], onlyA: ['only-a.txt'], onlyB: ['only-b.txt'] });
  });

  it('can be limited to some paths', async () => {
    const a = tree({ 'keep/a.txt': '1', 'skip/b.txt': '1' });
    const b = tree({ 'keep/a.txt': '1', 'skip/b.txt': '2' });
    const result = await compareTrees(a, b, (path) => path.startsWith('keep/'));
    expect(result).toMatchObject({ compared: 1, equal: 1, differing: [] });
  });

  it('is equal for empty folders', async () => {
    expect(await compareTrees(tree({}), tree({}))).toEqual({ compared: 0, equal: 0, differing: [], onlyA: [], onlyB: [] });
  });
});

describe('isComparable', () => {
  const comparable = (path: string): boolean => isComparable(path, '20261022', ['34', '06']);

  it('leaves out files only one side ever has', () => {
    expect(comparable('validation.json')).toBe(false);
    expect(comparable('borders.bin')).toBe(false);
    expect(comparable('addresses/34/addresses.jsonl')).toBe(true);
    expect(comparable('packs/34/address.sqlite')).toBe(true);
    expect(comparable('packs/34/route.bin')).toBe(true);
    expect(comparable('roads/34/roads.jsonl')).toBe(true);
    expect(comparable('clips/34.osm.pbf')).toBe(false);
  });

  it('compares the tiles of the chosen provinces only', () => {
    expect(comparable('tiles-20261022/34.pmtiles')).toBe(true);
    expect(comparable('tiles-20261022/06.pmtiles')).toBe(true);
    expect(comparable('tiles-20261022/01.pmtiles')).toBe(false);
    expect(comparable('tiles-20261021/01.pmtiles')).toBe(true);
    expect(comparable('base-20261022/overview.pmtiles')).toBe(true);
  });

  it('treats the pruned tiles like the tiles they come from', () => {
    expect(comparable('tiles-20261022-pruned/34.pmtiles')).toBe(true);
    expect(comparable('tiles-20261022-pruned/01.pmtiles')).toBe(false);
    expect(comparable('tiles-20261022-pruned-mlt/34.pmtiles')).toBe(true);
    expect(comparable('tiles-20261022-pruned-mlt/01.pmtiles')).toBe(false);
    expect(comparable('overture-pruned/01.pmtiles')).toBe(true);
    expect(comparable('base-20261022-pruned/fonts-compact/NotoSansRegular/0-255.pbf')).toBe(true);
  });
});

describe('stepsToRepeat', () => {
  const steps = (plates: string[]) =>
    buildSteps({ plates, sources: { osmMd5: 'x', tilesBuild: '20261022', osmTimestamp: 't' } as never, workDir: '/w', outDir: '/o', pbf: '/p', python: 'python', repoRoot: process.cwd(), run: async () => ({ code: 0, out: '' }) } as never);

  it('repeats every step that makes a pack file, building parts included', () => {
    const names = stepsToRepeat(steps(['34', '06', '20'])).map((s) => s.name);
    expect(names).toEqual(['sınırlar', 'adresler', 'sokaklar', 'yerler', 'binalar', 'işletmeler', 'adsız yollar', 'sokak adları', 'bina izleri', 'ulusal omurga', 'adres paketleri', 'bina paketleri 2', 'bina paketleri', 'rehber paketleri', 'yollar', 'rota paketleri', 'gömülü sınırlar']);
  });

  it('leaves out the tiles and the final publish step', () => {
    const names = stepsToRepeat(steps(['34'])).map((s) => s.name);
    expect(names).not.toContain('karolar');
    expect(names).not.toContain('karo budama');
    expect(names).not.toContain('karo kodlama');
    expect(names).not.toContain('doğrulama ve yayın');
  });

  it('has no building steps for provinces that get no building part', () => {
    expect(stepsToRepeat(steps(['01'])).map((s) => s.name)).not.toContain('bina paketleri');
  });
});
