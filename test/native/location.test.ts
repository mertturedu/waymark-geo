import type { MaplibreMock } from '../helpers/native-mocks';
import { position } from '../helpers/native-mocks';
import { firstFix } from '../../src/native/platform/location';

jest.mock('@maplibre/maplibre-react-native', () => jest.requireActual('../helpers/native-mocks').maplibreMock());

const maplibre = jest.requireMock('@maplibre/maplibre-react-native') as MaplibreMock;

beforeEach(() => {
  maplibre.state.cached = undefined;
  maplibre.listeners.clear();
});

const seconds = (p: ReturnType<typeof position>) => ({ ...p, timestamp: p.timestamp / 1000 });

describe('firstFix', () => {
  it('takes a fresh position whose timestamp is in seconds, as iOS reports it', async () => {
    maplibre.state.cached = seconds(position(29, 41, 5000));
    expect((await firstFix(1000))?.coords.longitude).toBe(29);
  });

  it('treats an old position in seconds as stale, not as fresh', async () => {
    maplibre.state.cached = seconds(position(27, 38, 10 * 60 * 1000));
    const waiting = firstFix(1000);
    maplibre.emit(seconds(position(29.5, 40.5)));
    expect((await waiting)?.coords.longitude).toBe(29.5);
  });

  it('returns a fresh cached position at once', async () => {
    maplibre.state.cached = position(29, 41, 5000);
    expect((await firstFix(1000))?.coords.longitude).toBe(29);
    expect(maplibre.listeners.size).toBe(0);
  });

  it('skips a stale cached position and waits for a fresh one', async () => {
    maplibre.state.cached = position(27, 38, 10 * 60 * 1000);
    const waiting = firstFix(1000);
    maplibre.emit(position(29.5, 40.5));
    expect((await waiting)?.coords.longitude).toBe(29.5);
    expect(maplibre.listeners.size).toBe(0);
  });

  it('falls back to a position some minutes old when nothing fresher arrives, as a still phone reports', async () => {
    maplibre.state.cached = position(27, 38, 10 * 60 * 1000);
    expect((await firstFix(30))?.coords.longitude).toBe(27);
    expect(maplibre.listeners.size).toBe(0);
  });

  it('gives up on a position older than half an hour and stops listening', async () => {
    maplibre.state.cached = position(27, 38, 2 * 60 * 60 * 1000);
    expect(await firstFix(30)).toBeUndefined();
    expect(maplibre.listeners.size).toBe(0);
  });

  it('prefers the newest of the stale positions', async () => {
    maplibre.state.cached = position(27, 38, 20 * 60 * 1000);
    const waiting = firstFix(60);
    maplibre.emit(position(28, 39, 5 * 60 * 1000));
    maplibre.emit(position(26, 37, 25 * 60 * 1000));
    expect((await waiting)?.coords.longitude).toBe(28);
  });

  it('accepts an older position when the caller allows it', async () => {
    maplibre.state.cached = position(27, 38, 10 * 60 * 1000);
    expect((await firstFix(1000, 60 * 60 * 1000))?.coords.longitude).toBe(27);
  });
});
