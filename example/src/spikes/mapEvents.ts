export type MapEventName = 'willStartLoadingMap' | 'didFinishLoadingMap' | 'didFailLoadingMap' | 'didFinishRenderingMapFully';

const seen: { name: MapEventName; at: number }[] = [];
const listeners = new Set<() => void>();

export const recordMapEvent = (name: MapEventName): void => {
  seen.push({ name, at: Date.now() });
  listeners.forEach((listener) => listener());
};

export const mapEventNames = (): MapEventName[] => seen.map((e) => e.name);

export const subscribeMapEvents = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const clearMapEvents = (): void => {
  seen.length = 0;
};
