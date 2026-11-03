import { clampPitch, DEFAULT_PITCH, jumpTilted, MAX_PITCH, normalBearing, safeView, tilted } from '../../src/native/map/camera';

describe('map camera', () => {
  it('leans the map about twenty degrees by default', () => {
    expect(DEFAULT_PITCH).toBe(20);
    expect(tilted({ center: [29, 41] as [number, number], zoom: 15 })).toEqual({ center: [29, 41], zoom: 15, pitch: 20 });
  });

  it('keeps a pitch the app asked for and stays between flat and the maximum', () => {
    expect(tilted({ pitch: 35 }).pitch).toBe(35);
    expect(tilted({ pitch: 0 }).pitch).toBe(0);
    expect(tilted({ pitch: 90 }).pitch).toBe(MAX_PITCH);
    expect(tilted({ pitch: -5 }).pitch).toBe(0);
  });

  it('does not change the view it is given', () => {
    const view = { zoom: 12 };
    tilted(view);
    expect(view).toEqual({ zoom: 12 });
  });
});

describe('safe camera views', () => {
  it('turns any bearing into 0 to 360', () => {
    expect(normalBearing(-90)).toBe(270);
    expect(normalBearing(720)).toBe(0);
    expect(normalBearing(359.9)).toBeCloseTo(359.9);
    expect(normalBearing(-450)).toBe(270);
    expect(normalBearing(Number.NaN)).toBe(0);
  });

  it('keeps pitch between flat and the maximum', () => {
    expect(clampPitch(90)).toBe(MAX_PITCH);
    expect(clampPitch(-5)).toBe(0);
    expect(clampPitch(Number.POSITIVE_INFINITY)).toBe(0);
    expect(safeView({ pitch: 90, bearing: -90, zoom: 3 })).toEqual({ pitch: 60, bearing: 270, zoom: 3 });
    expect(safeView({ zoom: 3 })).toEqual({ zoom: 3 });
    expect(tilted({ bearing: -10 })).toEqual({ bearing: 350, pitch: 20 });
  });
});

describe('jumpTilted', () => {
  const camera = () => ({ jumpTo: jest.fn() });
  const noWait = async () => undefined;
  const KADIKOY: [number, number] = [29.03, 40.99];
  const BESIKTAS: [number, number] = [29.0, 41.04];

  it('flattens first on a far tilted jump', async () => {
    const cam = camera();
    const reads = [{ center: [27.1, 38.4] as [number, number], zoom: 12 }, { center: KADIKOY, zoom: 16 }];
    await jumpTilted(cam, { center: KADIKOY, zoom: 16, pitch: 20 }, async () => reads.shift()!, 0, noWait);
    expect(cam.jumpTo.mock.calls.map((c) => c[0].pitch)).toEqual([0, 20]);
  });

  it('jumps once when the target is near or flat', async () => {
    const cam = camera();
    await jumpTilted(cam, { center: KADIKOY, zoom: 16, pitch: 20 }, async () => ({ center: BESIKTAS, zoom: 16 }), 0, noWait);
    expect(cam.jumpTo).toHaveBeenCalledTimes(1);
    const flat = camera();
    await jumpTilted(flat, { center: KADIKOY, zoom: 16 }, async () => ({ center: [27, 38], zoom: 16 }), 0, noWait);
    expect(flat.jumpTo).toHaveBeenCalledTimes(1);
  });

  it('sends the jump again once when the zoom landed off', async () => {
    const cam = camera();
    const reads = [{ center: BESIKTAS, zoom: 12 }, { center: KADIKOY, zoom: 16.1 }];
    await jumpTilted(cam, { center: KADIKOY, zoom: 16, bearing: -90 }, async () => reads.shift()!, 0, noWait);
    expect(cam.jumpTo).toHaveBeenCalledTimes(2);
    expect(cam.jumpTo.mock.calls[1]![0]).toEqual({ center: KADIKOY, zoom: 16, bearing: 270 });
  });

  it('waits between steps by default', async () => {
    const cam = camera();
    const started = Date.now();
    await jumpTilted(cam, { center: KADIKOY, zoom: 16 }, async () => ({ center: KADIKOY, zoom: 16 }), 20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});
