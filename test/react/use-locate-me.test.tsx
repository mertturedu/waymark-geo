import type { MaplibreMock, ReactNativeMock } from '../helpers/native-mocks';
import { flush, renderHook } from '../helpers/render-hook';
import { position } from '../helpers/native-mocks';
import { useLocateMe, type LocateOptions } from '../../src/native/react/useLocateMe';

jest.mock('@maplibre/maplibre-react-native', () => jest.requireActual('../helpers/native-mocks').maplibreMock());
jest.mock('react-native', () => jest.requireActual('../helpers/native-mocks').reactNativeMock());

const maplibre = jest.requireMock('@maplibre/maplibre-react-native') as MaplibreMock;
const reactNative = jest.requireMock('react-native') as ReactNativeMock;

const camera = () => ({ current: { easeTo: jest.fn(), zoomTo: jest.fn() } as never });

beforeEach(() => {
  maplibre.state.granted = true;
  maplibre.state.current = undefined;
  maplibre.state.cached = undefined;
  maplibre.listeners.clear();
  jest.clearAllMocks();
});

const render = (options: Partial<LocateOptions> = {}) => renderHook((props: Partial<LocateOptions>) => useLocateMe({ cameraRef: camera(), getZoom: () => 18, ...props }), options);

describe('useLocateMe', () => {
  it('reports a refused permission once and stays off', async () => {
    maplibre.state.granted = false;
    const onDenied = jest.fn();
    const hook = await render({ onDenied });
    await hook.result.current.press();
    await flush();
    expect(onDenied).toHaveBeenCalledTimes(1);
    expect(hook.result.current.permission).toBe('denied');
    expect(hook.result.current.mode).toBe('off');
    expect(hook.result.current.puck.visible).toBe(false);
    await hook.unmount();
  });

  it('cycles off, follow, heading and follow', async () => {
    maplibre.state.current = position(29.03, 40.99);
    const hook = await render({ granted: true });
    expect(hook.result.current.puck.visible).toBe(true);
    await hook.result.current.press();
    await flush();
    expect(hook.result.current.mode).toBe('follow');
    expect(hook.result.current.camera.trackUserLocation).toBe('default');
    await hook.result.current.press();
    await flush();
    expect(hook.result.current.mode).toBe('heading');
    expect(hook.result.current.camera.trackUserLocation).toBe('heading');
    await hook.result.current.press();
    await flush();
    expect(hook.result.current.mode).toBe('follow');
    await hook.unmount();
  });

  it('stops following when the native camera drops tracking', async () => {
    maplibre.state.current = position(29.03, 40.99);
    const hook = await render({ granted: true });
    await hook.result.current.press();
    await flush();
    await (async () => hook.result.current.camera.onTrackUserLocationChange({ nativeEvent: { trackUserLocation: null } } as never))();
    await flush();
    expect(hook.result.current.mode).toBe('off');
    expect(hook.result.current.camera.trackUserLocation).toBeUndefined();
    await hook.unmount();
  });

  it('zooms in to street level only when the map is farther out', async () => {
    maplibre.state.current = position(29.03, 40.99);
    const cameraRef = camera();
    const hook = await renderHook(() => useLocateMe({ cameraRef, getZoom: () => 12, granted: true }), {});
    const pressing = hook.result.current.press();
    await flush(700);
    await pressing;
    expect((cameraRef.current as unknown as { easeTo: jest.Mock }).easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [29.03, 40.99], zoom: 16 }));
    expect(hook.result.current.mode).toBe('follow');
    await hook.unmount();
  });

  it('gives up without following when no fix arrives', async () => {
    jest.useFakeTimers();
    const onUnavailable = jest.fn();
    const hook = await render({ granted: true, onUnavailable });
    const pressing = hook.result.current.press();
    await jest.advanceTimersByTimeAsync(5100);
    await pressing;
    jest.useRealTimers();
    await flush();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(hook.result.current.mode).toBe('off');
    expect(maplibre.listeners.size).toBe(0);
    await hook.unmount();
  });

  it('turns off and hides the dot when the permission is taken back', async () => {
    maplibre.state.current = position(29.03, 40.99);
    const hook = await renderHook((granted: boolean) => useLocateMe({ cameraRef: camera(), getZoom: () => 18, granted }), true as boolean);
    await hook.result.current.press();
    await flush();
    expect(hook.result.current.mode).toBe('follow');
    await hook.rerender(false);
    expect(hook.result.current.mode).toBe('off');
    expect(hook.result.current.permission).toBe('unknown');
    expect(hook.result.current.puck.visible).toBe(false);
    await hook.unmount();
  });

  it('asks again after a refusal so a change in Settings is picked up, and opens Settings', async () => {
    maplibre.state.granted = false;
    const onDenied = jest.fn();
    const hook = await render({ onDenied });
    await hook.result.current.press();
    await flush();
    await hook.result.current.press();
    await flush();
    expect(onDenied).toHaveBeenCalledTimes(2);
    expect(maplibre.LocationManager.requestPermissions).toHaveBeenCalledTimes(2);
    maplibre.state.granted = true;
    maplibre.state.current = position(29.03, 40.99);
    await hook.result.current.press();
    await flush();
    expect(hook.result.current.permission).toBe('granted');
    expect(hook.result.current.mode).toBe('follow');
    hook.result.current.openSettings();
    expect(reactNative.Linking.openSettings).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it('does not trust a cached position older than two minutes', async () => {
    maplibre.state.current = position(27.1, 38.4, 10 * 60 * 1000);
    const cameraRef = camera();
    const hook = await renderHook(() => useLocateMe({ cameraRef, getZoom: () => 12, granted: true }), {});
    const pressing = hook.result.current.press();
    await flush(50);
    maplibre.emit(position(29.03, 40.99));
    await flush(700);
    await pressing;
    expect((cameraRef.current as unknown as { easeTo: jest.Mock }).easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [29.03, 40.99] }));
    await hook.unmount();
  });
});
