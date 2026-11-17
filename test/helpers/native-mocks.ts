type Position = { coords: { longitude: number; latitude: number; accuracy: number; heading: number | null; altitude: number | null; altitudeAccuracy: number | null; speed: number | null }; timestamp: number };
type Listener = (position: Position) => void;

export const position = (longitude: number, latitude: number, ageMs = 0): Position => ({
  coords: { longitude, latitude, accuracy: 10, heading: null, altitude: null, altitudeAccuracy: null, speed: null },
  timestamp: Date.now() - ageMs,
});

export function maplibreMock() {
  const listeners = new Set<Listener>();
  const state = { granted: true, current: undefined as Position | undefined, cached: undefined as Position | undefined };
  const LocationManager = {
    addListener: jest.fn((listener: Listener) => {
      listeners.add(listener);
      if (state.cached) listener(state.cached);
    }),
    removeListener: jest.fn((listener: Listener) => void listeners.delete(listener)),
    requestPermissions: jest.fn(async () => state.granted),
    getCurrentPosition: jest.fn(async () => state.current),
  };
  const emit = (next: Position): void => {
    state.cached = next;
    for (const listener of [...listeners]) listener(next);
  };
  return { LocationManager, NativeUserLocation: () => null, state, listeners, emit };
}

export type MaplibreMock = ReturnType<typeof maplibreMock>;

export function reactNativeMock() {
  const appState = new Set<(state: string) => void>();
  const scheme: { current: 'light' | 'dark' | null } = { current: 'light' };
  return {
    useColorScheme: () => scheme.current,
    setColorScheme: (next: 'light' | 'dark' | null) => void (scheme.current = next),
    AppState: {
      addEventListener: jest.fn((_type: string, listener: (state: string) => void) => {
        appState.add(listener);
        return { remove: () => void appState.delete(listener) };
      }),
    },
    Linking: { openSettings: jest.fn(async () => undefined) },
    emitAppState: (state: string) => {
      for (const listener of [...appState]) listener(state);
    },
  };
}

export type ReactNativeMock = ReturnType<typeof reactNativeMock>;
