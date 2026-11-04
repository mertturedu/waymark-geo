import { act } from 'react-test-renderer';
import { renderHook } from '../helpers/render-hook';
import { useMapRotation, type RotationEvent, type RotationOptions } from '../../src/native/react/useMapRotation';
import { bearingChanged, northTarget } from '../../src/native/logic/rotation';

const event = (bearing: number | undefined, pitch: number | undefined = 30): RotationEvent => ({ nativeEvent: { center: [29.06, 40.19], zoom: 14, ...(bearing === undefined ? {} : { bearing }), ...(pitch === undefined ? {} : { pitch }) } }) as never;

const camera = () => ({ current: { easeTo: jest.fn() } as never });

const render = (options: Partial<RotationOptions> = {}) => renderHook((props: Partial<RotationOptions>) => useMapRotation({ cameraRef: camera(), ...props }), options);

describe('rotation logic', () => {
  it('asks the camera for north with the same centre and tilt', () => {
    expect(northTarget({ center: [29, 40], pitch: 45 })).toEqual({ center: [29, 40], bearing: 0, pitch: 45, duration: 400 });
    expect(northTarget({ center: [29, 40] }, 100)).toEqual({ center: [29, 40], bearing: 0, duration: 100 });
  });

  it('only reports a bearing change of half a degree or more, and the step to and from north', () => {
    expect(bearingChanged(10, 10.3)).toBe(false);
    expect(bearingChanged(10, 10.5)).toBe(true);
    expect(bearingChanged(0, 0.2)).toBe(false);
    expect(bearingChanged(0.4, 0)).toBe(true);
  });
});

describe('useMapRotation', () => {
  it('allows the two finger rotate gesture by default and can switch it off', async () => {
    const on = await render();
    expect(on.result.current.gestures).toEqual({ touchRotate: true });
    await on.unmount();
    const off = await render({ enabled: false });
    expect(off.result.current.gestures).toEqual({ touchRotate: false });
    await off.unmount();
  });

  it('follows the bearing from the map and passes the event on', async () => {
    const pass = jest.fn();
    const hook = await render({ onRegionDidChange: pass });
    await act(async () => hook.result.current.onRegionDidChange(event(40)));
    expect(hook.result.current.bearing).toBe(40);
    expect(hook.result.current.compass.bearing).toBe(40);
    expect(pass).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it('turns back to north over the same centre and tilt', async () => {
    const cameraRef = camera();
    const hook = await render({ cameraRef });
    await act(async () => hook.result.current.onRegionDidChange(event(80, 20)));
    hook.result.current.compass.onPress();
    expect((cameraRef.current as unknown as { easeTo: jest.Mock }).easeTo).toHaveBeenCalledWith({ center: [29.06, 40.19], bearing: 0, pitch: 20, duration: 400 });
    await hook.unmount();
  });

  it('does nothing when the map has not reported a position yet', async () => {
    const cameraRef = camera();
    const hook = await render({ cameraRef });
    hook.result.current.resetNorth();
    expect((cameraRef.current as unknown as { easeTo: jest.Mock }).easeTo).not.toHaveBeenCalled();
    await hook.unmount();
  });

  it('treats a missing bearing as north', async () => {
    const hook = await render();
    await act(async () => hook.result.current.onRegionDidChange(event(60)));
    await act(async () => hook.result.current.onRegionDidChange(event(undefined)));
    expect(hook.result.current.bearing).toBe(0);
    await hook.unmount();
  });
});
