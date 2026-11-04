import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetsToCopy, buildPackage } from '../../scripts/build-package';

const root = join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string; main: string; types: string; exports: Record<string, string | { types: string; default: string }>; files: string[]; peerDependencies: Record<string, string> };

type Packed = { files: { path: string }[]; size: number };
let packed: Packed;

beforeAll(() => {
  buildPackage({ tsc: (cwd) => void execFileSync('npx', ['tsc', '-p', 'tsconfig.build.json'], { cwd, stdio: 'pipe' }) });
  const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' });
  packed = (JSON.parse(out) as Packed[])[0] as Packed;
}, 300_000);

describe('the packed package', () => {
  it('has a built file behind every entry in exports, main and types', () => {
    const paths = new Set(packed.files.map((file) => file.path));
    const targets = Object.values(pkg.exports).flatMap((entry) => (typeof entry === 'string' ? [entry] : [entry.types, entry.default]));
    targets.push(pkg.main, pkg.types);
    for (const target of targets) expect(paths.has(target.replace(/^\.\//, ''))).toBe(true);
    expect(Object.keys(pkg.exports)).toEqual(['.', './core', './native', './app.plugin.cjs', './package.json']);
  });

  it('ships types and source maps for the compiled files', () => {
    const paths = packed.files.map((file) => file.path);
    for (const entry of ['lib/core/index', 'lib/native/index', 'lib/index']) {
      expect(paths).toContain(`${entry}.js`);
      expect(paths).toContain(`${entry}.d.ts`);
      expect(paths).toContain(`${entry}.js.map`);
    }
    const map = JSON.parse(readFileSync(join(root, 'lib/core/index.js.map'), 'utf8')) as { sourcesContent?: string[]; sources: string[] };
    expect(map.sourcesContent?.length).toBe(map.sources.length);
  });

  it('holds the images and the type file the compiled code points at', () => {
    const paths = packed.files.map((file) => file.path);
    expect(paths).toContain('lib/native/platform/assets.d.ts');
    expect(paths).toContain('lib/native/map/icons/geo-shield-state.png');
    expect(paths.filter((path) => path.endsWith('.png')).length).toBeGreaterThan(150);
    expect(paths).toContain('lib/native/map/chains.json');
    expect(paths).toContain('lib/core/text/data/admin.json');
  });

  it('leaves out sources, tests, tools, the node folder and the data pipeline', () => {
    const paths = packed.files.map((file) => file.path);
    const bad = paths.filter((path) => /^(src|test|scripts|pipeline|gates|example|tools|docs|fixtures)\//.test(path) || /\.test\.(js|ts)$/.test(path) || (path.endsWith('.ts') && !path.endsWith('.d.ts')) || path.includes('/node/'));
    expect(bad).toEqual([]);
    expect(paths.filter((path) => !path.startsWith('lib/')).sort()).toEqual(['CHANGELOG.md', 'LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'app.plugin.cjs', 'package.json']);
  });

  it('stays small and has the version of the SDK', () => {
    expect(packed.size).toBeLessThan(4_000_000);
    expect(pkg.version).toBe('0.6.0');
    expect(readFileSync(join(root, 'lib/core/create-geo.js'), 'utf8')).toContain(`'${pkg.version}'`);
  });

  it('asks the app for react and react-native instead of carrying them', () => {
    expect(Object.keys(pkg.peerDependencies)).toEqual(expect.arrayContaining(['react', 'react-native', 'expo', '@maplibre/maplibre-react-native']));
  });

  it('resolves for a TypeScript consumer through the exports map', () => {
    const dir = mkdtempSync(join(tmpdir(), 'consumer-'));
    mkdirSync(join(dir, 'node_modules', '@yuksi'), { recursive: true });
    symlinkSync(root, join(dir, 'node_modules', '@yuksi', 'geo'));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', target: 'ES2022', strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ['ES2022'] }, files: ['use.ts'] }));
    writeFileSync(join(dir, 'use.ts'), "import { createGeo, SDK_VERSION, upperTr, buildManeuvers } from '@yuksi/geo/core';\nimport { createGeo as same } from '@yuksi/geo';\nconst a: string = SDK_VERSION;\nconst b: string = upperTr('istiklal');\nvoid [createGeo, same, a, b, buildManeuvers];\n");
    execFileSync('npx', ['tsc', '-p', join(dir, 'tsconfig.json')], { cwd: root, stdio: 'pipe' });
  }, 120_000);

  it('only copies images and hand written type files by hand', () => {
    expect(assetsToCopy(['src/a.png', 'src/b.ts', 'src/native/platform/assets.d.ts', 'src/node/x.png', 'src/c.d.ts', 'src/native/map/chains.json'])).toEqual(['src/a.png', 'src/native/platform/assets.d.ts']);
  });
});
