import { modeOfTracking, needsZoom, nextMode, trackingOf, zoomFor } from '../../src/native/logic/locate';

describe('locate modes', () => {
  it('cycles off, follow, heading and back to follow', () => {
    expect(nextMode('off')).toBe('follow');
    expect(nextMode('follow')).toBe('heading');
    expect(nextMode('heading')).toBe('follow');
  });

  it('stays on follow when the heading mode is switched off', () => {
    expect(nextMode('follow', false)).toBe('follow');
    expect(nextMode('off', false)).toBe('follow');
  });

  it('maps modes to the camera tracking and back', () => {
    expect(trackingOf('off')).toBeUndefined();
    expect(trackingOf('follow')).toBe('default');
    expect(trackingOf('heading')).toBe('heading');
    expect(modeOfTracking(null)).toBe('off');
    expect(modeOfTracking(undefined)).toBe('off');
    expect(modeOfTracking('default')).toBe('follow');
    expect(modeOfTracking('heading')).toBe('heading');
    expect(modeOfTracking('course')).toBe('heading');
  });

  it('never zooms out when the map is already closer than the wanted zoom', () => {
    expect(zoomFor(12, 16)).toBe(16);
    expect(zoomFor(17.5, 16)).toBe(17.5);
    expect(zoomFor(undefined, 16)).toBe(16);
    expect(zoomFor(Number.NaN, 16)).toBe(16);
  });

  it('asks for a zoom change only when the map is farther out', () => {
    expect(needsZoom(12, 16)).toBe(true);
    expect(needsZoom(15.96, 16)).toBe(false);
    expect(needsZoom(18, 16)).toBe(false);
    expect(needsZoom(undefined, 16)).toBe(true);
  });
});
