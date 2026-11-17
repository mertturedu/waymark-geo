import type { ReactElement } from 'react';
import { renderHook } from '../helpers/render-hook';
import { GeoInstanceProvider } from '../../src/native/react/GeoProvider';
import { useMapStyle, type MapStyleHookOptions } from '../../src/native/react/hooks';

jest.mock('../../src/native/platform/create', () => ({ createGeoNative: jest.fn() }));
jest.mock('react-native', () => jest.requireActual('../helpers/native-mocks').reactNativeMock());

const rn = jest.requireMock('react-native') as { setColorScheme(scheme: 'light' | 'dark' | null): void };

const REGIONS = [
  { id: '34', bbox: [27.97, 40.74, 29.96, 41.67] },
  { id: '41', bbox: [29.32, 40.52, 30.51, 41.42] },
  { id: '20', bbox: [28.57, 36.85, 30.08, 38.47] },
  { id: '06', bbox: [31.4, 39.1, 33.2, 40.6] },
];

function fakeGeo(installed: string[]) {
  const style = jest.fn((options: { only?: string[] }) => ({ version: 8, sources: {}, layers: [], only: options.only }));
  const geo = {
    regions: { list: () => REGIONS, installed: () => installed, baseDir: () => 'base', subscribe: () => () => undefined },
    search: { hoods: async () => [] },
    map: { style, stream: { active: () => [], subscribe: () => () => undefined } },
  } as never;
  return { geo, style };
}

const withGeo = (geo: never) => (child: ReactElement) => <GeoInstanceProvider geo={geo}>{child}</GeoInstanceProvider>;
const options = (extra: Partial<MapStyleHookOptions> = {}): MapStyleHookOptions => ({ theme: 'light', language: 'tr', ...extra });

describe('useMapStyle with a view', () => {
  it('builds the style once, with all provinces, when the app gives no view', async () => {
    const { geo, style } = fakeGeo(['34', '41', '20']);
    const hook = await renderHook((o: MapStyleHookOptions) => useMapStyle(o), options(), withGeo(geo));
    expect(style).toHaveBeenCalledTimes(1);
    expect(style.mock.calls[0]![0]).not.toHaveProperty('only');
    await hook.unmount();
  });

  it('builds the style once, already limited to the provinces near the view', async () => {
    const { geo, style } = fakeGeo(['34', '41', '20', '06']);
    const hook = await renderHook((o: MapStyleHookOptions) => useMapStyle(o), options({ view: { center: [28.4, 41.2], zoom: 15 } }), withGeo(geo));
    expect(style).toHaveBeenCalledTimes(1);
    expect(style.mock.calls[0]![0].only).toEqual(['34']);
    await hook.unmount();
  });

  it('keeps the very same style while the view moves inside the province', async () => {
    const { geo, style } = fakeGeo(['34', '41', '20']);
    const hook = await renderHook((o: MapStyleHookOptions) => useMapStyle(o), options({ view: { center: [28.4, 41.2], zoom: 15 } }), withGeo(geo));
    const first = hook.result.current;
    await hook.rerender(options({ view: { center: [28.5, 41.3], zoom: 16 } }));
    await hook.rerender(options({ view: { center: [28.45, 41.25], zoom: 12 } }));
    expect(hook.result.current).toBe(first);
    expect(style).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it('builds a new style once when the view moves to another province', async () => {
    const { geo, style } = fakeGeo(['34', '41', '20']);
    const hook = await renderHook((o: MapStyleHookOptions) => useMapStyle(o), options({ view: { center: [28.4, 41.2], zoom: 15 } }), withGeo(geo));
    await hook.rerender(options({ view: { center: [29.09, 37.78], zoom: 13 } }));
    expect(style).toHaveBeenCalledTimes(2);
    expect(style.mock.calls[1]![0].only).toEqual(['20']);
    await hook.rerender(options({ view: { center: [29.1, 37.8], zoom: 14 } }));
    expect(style).toHaveBeenCalledTimes(2);
    await hook.unmount();
  });

  it('leaves out installed provinces that are far from the view', async () => {
    const { geo, style } = fakeGeo(['34', '41', '20', '06']);
    const hook = await renderHook((o: MapStyleHookOptions) => useMapStyle(o), options({ view: { center: [32.5, 39.8], zoom: 14 } }), withGeo(geo));
    expect(style.mock.calls.at(-1)![0].only).toEqual(['06']);
    await hook.unmount();
  });
});

describe('useMapStyle with theme auto', () => {
  afterEach(() => rn.setColorScheme('light'));

  it('follows the system appearance and builds the style once for it', async () => {
    rn.setColorScheme('dark');
    const { geo, style } = fakeGeo(['34']);
    const hook = await renderHook((o: MapStyleHookOptions) => useMapStyle(o), options({ theme: 'auto' }), withGeo(geo));
    expect(style).toHaveBeenCalledTimes(1);
    expect(style.mock.calls[0]![0]).toMatchObject({ theme: 'dark' });
    await hook.unmount();
  });

  it('falls back to light when the system gives no answer and ignores the system for a fixed theme', async () => {
    rn.setColorScheme(null);
    const auto = fakeGeo(['34']);
    const first = await renderHook((o: MapStyleHookOptions) => useMapStyle(o), options({ theme: 'auto' }), withGeo(auto.geo));
    expect(auto.style.mock.calls[0]![0]).toMatchObject({ theme: 'light' });
    await first.unmount();
    rn.setColorScheme('dark');
    const fixed = fakeGeo(['34']);
    const second = await renderHook((o: MapStyleHookOptions) => useMapStyle(o), options({ theme: 'light' }), withGeo(fixed.geo));
    expect(fixed.style.mock.calls[0]![0]).toMatchObject({ theme: 'light' });
    await second.unmount();
  });
});
