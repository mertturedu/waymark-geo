export type Tap = { point: [number, number]; at: number };

let last: Tap | null = null;

export const setLastTap = (point: [number, number]): void => {
  last = { point, at: Date.now() };
};

export const lastTap = (): Tap | null => last;
