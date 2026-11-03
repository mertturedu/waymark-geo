import type { ReactElement } from 'react';
import type { MaplibreMock, ReactNativeMock } from '../helpers/native-mocks';
import { act } from 'react-test-renderer';
import { flush, renderHook } from '../helpers/render-hook';
import { position } from '../helpers/native-mocks';
import { GeoInstanceProvider } from '../../src/native/react/GeoProvider';
import { useLocationRegion } from '../../src/native/react/useLocationRegion';

jest.mock('@maplibre/maplibre-react-native', () => jest.requireActual('../helpers/native-mocks').maplibreMock());
jest.mock('react-native', () => jest.requireActual('../helpers/native-mocks').reactNativeMock());
jest.mock('../../src/native/platform/create', () => ({ createGeoNative: jest.fn() }));

const maplibre = jest.requireMock('@maplibre/maplibre-react-native') as MaplibreMock;
const reactNative = jest.requireMock('react-native') as ReactNativeMock;

function fakeGeo(action: 'download' | 'suggest' | 'consent' = 'download') {
  const connection = { kind: 'wifi' as 'wifi' | 'cellular' };
  const listeners = new Set<(kind: string) => void>();
  const suggest = jest.fn((point: [number, number]) => ({ action, regions: point[1] < 39.5 ? ['64'] : ['34'], neighbours: [] as string[] }));
  const download = jest.fn<Promise<undefined>, [string, unknown?]>(async () => undefined);
  const geo = {
    regions: {
      suggest,
      download,
      dismiss: jest.fn(),
      subscribe: () => () => undefined,
      connection: async () => connection.kind,
      onConnection: (listener: (kind: string) => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
  } as never;
  return { geo, suggest, download, connection, changeConnection: (kind: 'wifi' | 'cellular') => { connection.kind = kind; listeners.forEach((listener) => listener(kind)); } };
}

const withGeo = (geo: never) => (child: ReactElement) => <GeoInstanceProvider geo={geo}>{child}</GeoInstanceProvider>;

beforeEach(() => {
  maplibre.state.cached = undefined;
  maplibre.listeners.clear();
  jest.clearAllMocks();
});

describe('useLocationRegion', () => {
  it('does not read the position without permission', async () => {
    const { geo, suggest } = fakeGeo();
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), false, withGeo(geo));
    await flush();
    expect(maplibre.LocationManager.addListener).not.toHaveBeenCalled();
    expect(hook.result.current.location).toBeNull();
    expect(suggest).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it('downloads the province of the position once', async () => {
    maplibre.state.cached = position(29.4, 38.68);
    const { geo, download } = fakeGeo();
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), true, withGeo(geo));
    await flush();
    expect(hook.result.current.location).toEqual([29.4, 38.68]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith('64');
    await hook.rerender(true);
    await flush();
    expect(download).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it('only suggests when the app asks first', async () => {
    maplibre.state.cached = position(29.4, 38.68);
    const { geo, download } = fakeGeo('suggest');
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), true, withGeo(geo));
    await flush();
    expect(hook.result.current.decision.action).toBe('suggest');
    expect(download).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it('reads again in the foreground and ignores small moves', async () => {
    maplibre.state.cached = position(29.03, 40.99);
    const { geo, suggest, download } = fakeGeo();
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), true, withGeo(geo));
    await flush();
    const first = hook.result.current.location;
    const calls = suggest.mock.calls.length;
    maplibre.state.cached = position(29.031, 40.991);
    reactNative.emitAppState('active');
    await flush();
    expect(hook.result.current.location).toBe(first);
    expect(suggest.mock.calls.length).toBe(calls + 1);
    expect(download).toHaveBeenCalledTimes(1);
    maplibre.state.cached = position(29.2, 41.05);
    reactNative.emitAppState('active');
    await flush();
    expect(hook.result.current.location).toEqual([29.2, 41.05]);
    await hook.unmount();
  });

  it('asks first on mobile data and downloads once the person says yes, with mobile data allowed', async () => {
    maplibre.state.cached = position(29.4, 38.68);
    const { geo, download } = fakeGeo('consent');
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), true, withGeo(geo));
    await flush();
    expect(hook.result.current.decision.action).toBe('consent');
    expect(download).not.toHaveBeenCalled();
    await act(async () => hook.result.current.accept());
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith('64', { allowCellular: true });
    await hook.unmount();
  });

  it('queues the download for Wi-Fi when the person chooses to wait', async () => {
    maplibre.state.cached = position(29.4, 38.68);
    const { geo, download } = fakeGeo('consent');
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), true, withGeo(geo));
    await flush();
    await act(async () => hook.result.current.waitForWifi());
    expect(download).toHaveBeenCalledWith('64', { wifiOnly: true });
    await hook.unmount();
  });

  it('only takes the own province when answering a consent, not the neighbour', async () => {
    maplibre.state.cached = position(29.4, 38.68);
    const { geo, download, suggest } = fakeGeo('consent');
    suggest.mockImplementation(() => ({ action: 'consent' as const, regions: ['64'], neighbours: ['20'] }));
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), true, withGeo(geo));
    await flush();
    await act(async () => hook.result.current.accept());
    expect(download.mock.calls.map((call) => call[0])).toEqual(['64']);
    await hook.unmount();
  });

  it('checks again when the connection changes, so a pending question can turn into a download', async () => {
    maplibre.state.cached = position(29.4, 38.68);
    const { geo, download, suggest, changeConnection } = fakeGeo('consent');
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), true, withGeo(geo));
    await flush();
    expect(download).not.toHaveBeenCalled();
    suggest.mockImplementation(() => ({ action: 'download' as const, regions: ['64'], neighbours: [] }));
    await act(async () => changeConnection('wifi'));
    await flush();
    expect(hook.result.current.decision.action).toBe('download');
    expect(download).toHaveBeenCalledWith('64');
    await hook.unmount();
  });

  it('asks the connection again with every decision', async () => {
    maplibre.state.cached = position(29.4, 38.68);
    const { geo, suggest, changeConnection } = fakeGeo('download');
    const hook = await renderHook((granted: boolean) => useLocationRegion({ granted }), true, withGeo(geo));
    await flush();
    expect(suggest).toHaveBeenLastCalledWith([29.4, 38.68], { connection: 'wifi' });
    await act(async () => changeConnection('cellular'));
    await flush();
    expect(suggest).toHaveBeenLastCalledWith([29.4, 38.68], { connection: 'cellular' });
    await hook.unmount();
  });
});

