import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { movedEnough, MIN_MOVE_M, nextReadMs, type Point } from '../logic/location-region';
import { firstFix } from '../platform/location';
import { useAutoRegion } from './hooks';

const READ_MS = 10_000;

export function useLocationRegion({ granted, minMoveM = MIN_MOVE_M }: { granted: boolean; minMoveM?: number }) {
  const [location, setLocation] = useState<Point | null>(null);
  const last = useRef<Point | null>(null);
  const control = useAutoRegion(location);
  const refreshRef = useRef(control.refresh);
  refreshRef.current = control.refresh;

  useEffect(() => {
    if (!granted) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      clearTimeout(timer);
      const position = await firstFix(READ_MS);
      if (!alive) return;
      const next: Point | null = position ? [position.coords.longitude, position.coords.latitude] : null;
      if (next && movedEnough(last.current, next, minMoveM)) {
        last.current = next;
        setLocation(next);
      } else refreshRef.current();
      timer = setTimeout(() => void read(), nextReadMs(position !== undefined));
    };
    void read();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      refreshRef.current();
      void read();
    });
    return () => {
      alive = false;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [granted, minMoveM]);

  return { location, ...control };
}
