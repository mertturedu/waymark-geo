const applied: unknown[][] = [];

jest.mock('expo/config-plugins', () => ({ withPlugins: (config: object, plugins: unknown[]) => (applied.push(plugins), { ...config, tagged: true }) }), { virtual: true });

const withGeo = jest.requireActual('../../app.plugin.js') as (config: { plugins?: unknown[] }) => { plugins?: unknown[]; tagged?: boolean };

describe('app.plugin.js', () => {
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
});
