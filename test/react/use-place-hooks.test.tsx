import type { ReactElement } from 'react';
import { flush, renderHook } from '../helpers/render-hook';
import { GeoInstanceProvider } from '../../src/native/react/GeoProvider';
import { useHereLabel, useNearby, usePlaceAt } from '../../src/native/react/hooks';

jest.mock('../../src/native/platform/create', () => ({ createGeoNative: jest.fn() }));
jest.mock('react-native', () => jest.requireActual('../helpers/native-mocks').reactNativeMock());

const PLACE = { id: 'a', label: 'x', components: { neighbourhood: 'Caferağa Mah.', street: 'Moda Caddesi', houseNumber: '12' }, coordinate: [29, 41], precision: 'address', approximate: false, source: 'osm', confidence: 1, region: '34' };

function fake(overrides: { reverse?: jest.Mock; nearby?: jest.Mock } = {}) {
  const reverse = overrides.reverse ?? jest.fn(async () => PLACE);
  const nearby = overrides.nearby ?? jest.fn(async () => [{ place: PLACE, distanceM: 120 }]);
  const geo = { regions: { subscribe: () => () => undefined }, search: { reverse, nearby } } as never;
  return { geo, reverse, nearby };
}
const withGeo = (geo: never) => (child: ReactElement) => <GeoInstanceProvider geo={geo}>{child}</GeoInstanceProvider>;

describe('useHereLabel', () => {
  it('says what is near once the position has settled', async () => {
    const { geo, reverse } = fake();
    const hook = await renderHook((p: [number, number] | null) => useHereLabel(p, 'tr', 0), [29, 41] as [number, number], withGeo(geo));
    await flush(5);
    expect(hook.result.current).toBe('Caferağa Mah., Moda Caddesi 12 civarı');
    expect(reverse).toHaveBeenCalledTimes(1);
    await hook.unmount();
  });

  it('asks again only when the position really changes and clears without one', async () => {
    const { geo, reverse } = fake();
    const hook = await renderHook((p: [number, number] | null) => useHereLabel(p, 'en', 0), [29, 41] as [number, number] | null, withGeo(geo));
    await flush(5);
    await hook.rerender([29.00001, 41.00001]);
    await flush(5);
    expect(reverse).toHaveBeenCalledTimes(1);
    await hook.rerender([29.01, 41.01]);
    await flush(5);
    expect(reverse).toHaveBeenCalledTimes(2);
    expect(hook.result.current).toBe('Near Caferağa Mah., Moda Caddesi 12');
    await hook.rerender(null);
    await flush(5);
    expect(hook.result.current).toBeNull();
    await hook.unmount();
  });

  it('shows nothing when the lookup fails', async () => {
    const { geo } = fake({ reverse: jest.fn(async () => Promise.reject(new Error('no pack'))) });
    const hook = await renderHook((p: [number, number] | null) => useHereLabel(p, 'tr', 0), [29, 41] as [number, number], withGeo(geo));
    await flush(5);
    expect(hook.result.current).toBeNull();
    await hook.unmount();
  });

  it('waits for the delay before asking', async () => {
    const { geo, reverse } = fake();
    const hook = await renderHook((p: [number, number] | null) => useHereLabel(p, 'tr', 60), [29, 41] as [number, number], withGeo(geo));
    await flush(10);
    expect(reverse).not.toHaveBeenCalled();
    await hook.unmount();
    await flush(80);
    expect(reverse).not.toHaveBeenCalled();
  });
});

describe('usePlaceAt', () => {
  const badge = { properties: { name: 'Güneş Eczanesi', grp: 'pharmacy' }, geometry: { type: 'Point', coordinates: [29, 41] } };

  it('opens a card for the badge under the finger and closes it', async () => {
    const { geo } = fake();
    const hook = await renderHook(() => usePlaceAt(() => [100, 100], 'tr'), undefined, withGeo(geo));
    expect(hook.result.current.card).toBeNull();
    await (async () => {
      const { act } = await import('react-test-renderer');
      await act(async () => void (await hook.result.current.pick([badge], { x: 105, y: 100 })));
    })();
    expect(hook.result.current.card?.title).toBe('Güneş Eczanesi');
    const { act } = await import('react-test-renderer');
    await act(async () => hook.result.current.close());
    expect(hook.result.current.card).toBeNull();
    await hook.unmount();
  });

  it('closes the card when the tap is not on a badge', async () => {
    const { geo } = fake();
    const hook = await renderHook(() => usePlaceAt(() => [100, 100], 'tr'), undefined, withGeo(geo));
    const { act } = await import('react-test-renderer');
    await act(async () => void (await hook.result.current.pick([badge], { x: 105, y: 100 })));
    await act(async () => void (await hook.result.current.pick([badge], { x: 400, y: 400 })));
    expect(hook.result.current.card).toBeNull();
    await hook.unmount();
  });
});

describe('useNearby', () => {
  it('lists what is near for a group and asks again for another group', async () => {
    const { geo, nearby } = fake();
    const hook = await renderHook((group: 'pharmacy' | 'fuel' | null) => useNearby([29, 41], group, { limit: 3 }), 'pharmacy' as 'pharmacy' | 'fuel' | null, withGeo(geo));
    await flush(5);
    expect(hook.result.current.hits).toHaveLength(1);
    expect(hook.result.current.loading).toBe(false);
    expect(nearby.mock.calls[0]![0]).toMatchObject({ point: [29, 41], group: 'pharmacy', limit: 3 });
    await hook.rerender('fuel');
    await flush(5);
    expect(nearby).toHaveBeenCalledTimes(2);
    expect(nearby.mock.calls[1]![0]).toMatchObject({ group: 'fuel' });
    await hook.rerender(null);
    await flush(5);
    expect(hook.result.current.hits).toEqual([]);
    await hook.unmount();
  });

  it('gives an empty list when the search fails', async () => {
    const { geo } = fake({ nearby: jest.fn(async () => Promise.reject(new Error('x'))) });
    const hook = await renderHook(() => useNearby([29, 41], 'pharmacy', { radiusM: 500, language: 'en' }), undefined, withGeo(geo));
    await flush(5);
    expect(hook.result.current).toEqual({ hits: [], loading: false });
    await hook.unmount();
  });
});
