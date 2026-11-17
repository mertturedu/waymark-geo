import { missingFiles, pickInstallFiles, progressLine } from '../../example/src/device-test/install-list';

const file = (path: string, size = 10) => ({ path, size, sha256: 'x' });

describe('pickInstallFiles', () => {
  it('skips the benchmark blob and keeps map, fonts, sprites and databases', () => {
    const picked = pickInstallFiles({
      protomapsBuild: '1',
      files: [file('blob-30mb.bin', 5), file('istanbul.pmtiles', 40), file('fonts/Noto Sans Regular/0-255.pbf', 2), file('sprites/v4/light.json', 1), file('istanbul-streets.db', 30)],
    });
    expect(picked.map((f) => f.path)).toEqual(['sprites/v4/light.json', 'fonts/Noto Sans Regular/0-255.pbf', 'istanbul-streets.db', 'istanbul.pmtiles']);
  });

  it('installs small files first so the map screen works early', () => {
    const picked = pickInstallFiles({ protomapsBuild: '1', files: [file('big.pmtiles', 1000), file('small.json', 1), file('mid.db', 100)] });
    expect(picked.map((f) => f.size)).toEqual([1, 100, 1000]);
  });

  it('returns nothing for an empty manifest', () => {
    expect(pickInstallFiles({ protomapsBuild: '1', files: [] })).toEqual([]);
  });
});

describe('progressLine', () => {
  it('shows the position, the name and the percentage', () => {
    expect(progressLine(2, 10, 'istanbul.pmtiles', 50, 200)).toBe('3/10 istanbul.pmtiles %25');
  });

  it('never divides by zero', () => {
    expect(progressLine(0, 1, 'a', 0, 0)).toBe('1/1 a %0');
  });
});

describe('missingFiles', () => {
  const manifest = {
    protomapsBuild: '1',
    files: [
      { path: 'a.bin', size: 10, sha256: 'x' },
      { path: 'b.bin', size: 20, sha256: 'y' },
      { path: 'blob-30mb.bin', size: 30, sha256: 'z' },
    ],
  };

  it('counts files that are absent or have the wrong size, skipping the ones never installed', () => {
    const sizes: Record<string, number | null> = { 'a.bin': 10, 'b.bin': 5, 'blob-30mb.bin': null };
    expect(missingFiles(manifest, (path) => sizes[path] ?? null)).toBe(1);
  });

  it('is zero when everything is in place and counts absent files', () => {
    expect(missingFiles(manifest, (path) => (path === 'a.bin' ? 10 : path === 'b.bin' ? 20 : null))).toBe(0);
    expect(missingFiles(manifest, () => null)).toBe(2);
  });
});
