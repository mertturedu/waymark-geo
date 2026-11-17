import { attachHandle, openTour, tourState, type MapHandle, type View } from '../../example/src/sdk-test/map-tour/driver';

function fakeHandle(): MapHandle & { counters: { frames: number }; jumps: View[]; flights: View[] } {
  const counters = { frames: 0 };
  const jumps: View[] = [];
  const flights: View[] = [];
  let current: View = { center: [29, 41], zoom: 12 };
  return {
    counters,
    jumps,
    flights,
    frames: () => counters.frames,
    events: () => ['mount', 'loaded'],
    size: () => ({ width: 390, height: 700 }),
    layerIds: (prefix) => ['roads_a@base', 'roads_b@r34', 'buildings@r34'].filter((id) => id.startsWith(prefix)),
    fly: (view) => {
      flights.push(view);
      current = view;
      setTimeout(() => (counters.frames += 1), 30);
    },
    jump: (view) => {
      jumps.push(view);
      current = view;
      setTimeout(() => (counters.frames += 1), 10);
    },
    view: async () => current,
    query: async (layers) => (layers ?? []).map((id) => ({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [29, 41] } })),
    project: async () => [10, 20],
    unproject: async () => [29, 41],
    plan: () => ({}) as never,
  };
}

const geo = {} as never;

describe('map tour driver', () => {
  it('waits for the first full frame before the map counts as ready', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    setTimeout(() => {
      attachHandle(handle);
      setTimeout(() => (handle.counters.frames += 1), 30);
    }, 20);
    expect(await tour.ready()).toBeGreaterThanOrEqual(30);
    tour.close();
  });

  it('settles after the view arrived and the rendered feature count stopped changing', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    const ms = await tour.go({ center: [29.1, 41.1], zoom: 15 }, 'jump');
    expect(handle.jumps).toEqual([{ center: [29.1, 41.1], zoom: 15 }]);
    expect(ms).toBeGreaterThanOrEqual(400);
    const flown = await tour.go({ center: [29.2, 41.2], zoom: 13 }, 'fly', 500);
    expect(handle.flights).toHaveLength(1);
    expect(flown).toBeGreaterThanOrEqual(400);
    const again = await tour.go({ center: [29.2, 41.2], zoom: 13 }, 'jump');
    expect(handle.jumps).toHaveLength(1);
    expect(again).toBeGreaterThanOrEqual(400);
    tour.close();
  });

  it('waits while the rendered feature count still grows', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    let reads = 0;
    handle.query = async (layers) => {
      reads += 1;
      const size = reads < 5 ? reads : 5;
      return Array.from({ length: layers ? size : 0 }, () => ({ properties: null, geometry: { type: 'Point', coordinates: [29, 41] } }));
    };
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    await tour.go({ center: [29.3, 41.3], zoom: 14 }, 'jump');
    expect(reads).toBeGreaterThanOrEqual(7);
    tour.close();
  });

  it('polls a layer count until it reaches the minimum or the time runs out', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    let reads = 0;
    handle.query = async () => {
      reads += 1;
      return Array.from({ length: reads }, () => ({ properties: null, geometry: { type: 'Point', coordinates: [29, 41] } }));
    };
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    const reached = await tour.until(['roads_'], 3, 5000);
    expect(reached.count).toBe(3);
    reads = 0;
    const missed = await tour.until(['roads_'], 1000, 600);
    expect(missed.count).toBeGreaterThan(0);
    expect(missed.waitedMs).toBeGreaterThanOrEqual(600);
    expect(await tour.until(['no-such-layer'], 1, 300)).toMatchObject({ count: 0 });
    tour.close();
  });

  it('retries the view while the native map is still starting', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    let calls = 0;
    const real = handle.view;
    handle.view = async () => {
      calls += 1;
      if (calls > 2 && calls < 6) throw new Error('NativeComponent ref is null, wait for the map being initialized');
      return real();
    };
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    setTimeout(() => attachHandle(handle), 20);
    await tour.look({ lang: 'en' });
    expect(calls).toBeGreaterThanOrEqual(6);
    tour.close();
  });

  it('keeps the map when the look does not change and rebuilds it when it does', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    expect(await tour.look({ theme: 'light', lang: 'tr' })).toBe(0);
    setTimeout(() => attachHandle(handle), 30);
    await tour.look({ theme: 'dark' });
    expect(tourState().look.theme).toBe('dark');
    tour.close();
  });

  it('queries layers by prefix and returns nothing for an unknown prefix', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    expect((await tour.query(['roads_'])).map((f) => f.properties?.id)).toEqual(['roads_a@base', 'roads_b@r34']);
    expect(await tour.query(['ov-brand@'])).toEqual([]);
    expect(tour.layers('buildings@')).toEqual(['buildings@r34']);
    tour.close();
  });

  it('measures the longest gap of the JS timer while work runs', async () => {
    const tour = await openTour(geo);
    attachHandle(fakeHandle());
    const quiet = await tour.gaps(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return 'done';
    });
    expect(quiet.value).toBe('done');
    expect(quiet.ticks).toBeGreaterThan(2);
    const blocked = await tour.gaps(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      const until = Date.now() + 150;
      while (Date.now() < until);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(blocked.maxGapMs).toBeGreaterThanOrEqual(120);
    tour.close();
  });

  it('passes the map events through for diagnostics', async () => {
    const tour = await openTour(geo);
    attachHandle(fakeHandle());
    expect(tour.events()).toEqual(['mount', 'loaded']);
    tour.close();
    expect(tour.events()).toEqual([]);
  });

  it('hides the overlay state when the tour closes', async () => {
    const tour = await openTour(geo);
    tour.say('adım');
    expect(tourState().status).toBe('adım');
    expect(tourState().geo).toBe(geo);
    tour.close();
    expect(tourState().geo).toBeNull();
  });

  it('carries bearing and pitch to the camera and waits until they are reached', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    await tour.go({ center: [29.1, 41.1], zoom: 15, bearing: 90, pitch: 45 }, 'jump');
    expect(handle.jumps[0]).toEqual({ center: [29.1, 41.1], zoom: 15, bearing: 90, pitch: 45 });
    await tour.go({ center: [29.1, 41.1], zoom: 15, bearing: 450, pitch: 45 }, 'jump');
    expect(handle.jumps).toHaveLength(1);
    await tour.go({ center: [29.1, 41.1], zoom: 15, bearing: 0, pitch: 45 }, 'jump');
    expect(handle.jumps).toHaveLength(2);
    tour.close();
  });

  it('changes the frame, keeps the view and resets the frame on close', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    await tour.go({ center: [29.1, 41.1], zoom: 15 }, 'jump');
    expect(await tour.frame('full')).toBe(0);
    await tour.frame('landscape');
    expect(tourState().frame).toBe('landscape');
    expect(handle.jumps).toHaveLength(2);
    tour.close();
    expect(tourState().frame).toBe('full');
  });
  it('sends the jump again when the camera lands off target', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    let skewed = true;
    const real = handle.jump;
    handle.jump = (view) => {
      real(skewed ? { ...view, zoom: view.zoom + 0.5 } : view);
      skewed = false;
    };
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    await tour.go({ center: [29.1, 41.1], zoom: 15, pitch: 45 }, 'jump');
    expect((await handle.view()).zoom).toBe(15);
    tour.close();
  });

  it('waits for the next fully drawn frame after a step', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    const before = tour.frames();
    await tour.step({ center: [29.2, 41.2], zoom: 16 });
    expect(await tour.rendered(before, 2000)).toBeGreaterThanOrEqual(0);
    expect(tour.frames()).toBeGreaterThan(before);
    await expect(tour.rendered(tour.frames(), 200)).rejects.toThrow(/tam kare/);
    tour.close();
    expect(tour.frames()).toBe(0);
  });

  it('counts style loads since the last mount', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    handle.events = () => ['mount:a', 'style@1', 'loaded@2', 'mount:b', 'style@3', 'style@4', 'loaded@5'];
    attachHandle(handle);
    expect(tour.styleLoads()).toBe(2);
    handle.events = () => ['style@1'];
    expect(tour.styleLoads()).toBe(1);
    tour.close();
    expect(tour.styleLoads()).toBe(0);
  });

  it('jumps through the SDK helper and reports where the camera landed', async () => {
    const tour = await openTour(geo);
    const handle = fakeHandle();
    attachHandle(handle);
    handle.counters.frames = 1;
    await tour.ready();
    const landed = await tour.jumpSafe({ center: [26.9, 38.4], zoom: 16, pitch: 20, bearing: -90 });
    expect(handle.jumps.map((view) => view.pitch)).toEqual([0, 20]);
    expect(landed).toEqual({ center: [26.9, 38.4], zoom: 16, pitch: 20, bearing: 270 });
    tour.close();
  });
});

