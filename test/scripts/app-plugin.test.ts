import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const applied: unknown[][] = [];

jest.mock('expo/config-plugins', () => ({ withPlugins: (config: object, plugins: unknown[]) => (applied.push(plugins), { ...config, tagged: true }) }), { virtual: true });

const withGeo = jest.requireActual('../../app.plugin.cjs') as (config: { plugins?: unknown[] }) => { plugins?: unknown[]; tagged?: boolean };

describe('app.plugin.cjs', () => {
  beforeEach(() => void (applied.length = 0));

  it('adds the MapLibre plugin when the app did not list it', () => {
    const result = withGeo({ plugins: ['expo-sqlite'] });
    expect(applied).toEqual([['@maplibre/maplibre-react-native']]);
    expect(result.tagged).toBe(true);
  });

  it('works for an app without a plugins list', () => {
    withGeo({});
    expect(applied).toHaveLength(1);
  });

  it('leaves the config alone when the app already lists MapLibre, with or without options', () => {
    const plain = { plugins: ['@maplibre/maplibre-react-native'] };
    expect(withGeo(plain)).toBe(plain);
    const withOptions = { plugins: [['@maplibre/maplibre-react-native', { x: 1 }], '@yuksi/geo'] };
    expect(withGeo(withOptions)).toBe(withOptions);
    expect(applied).toEqual([]);
  });

  it('loads as a function the way Expo loads config plugins, in a package of ES modules', () => {
    const root = join(__dirname, '..', '..');
    const script = "process.stdout.write(typeof require('@expo/require-utils').loadModuleSync(process.argv[1]))";
    expect(execFileSync(process.execPath, ['-e', script, join(root, 'app.plugin.cjs')], { cwd: root, encoding: 'utf8' })).toBe('function');
  });
});
