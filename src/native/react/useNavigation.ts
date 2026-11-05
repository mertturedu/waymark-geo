import { useEffect, useRef, useState } from 'react';
import type { DirectionsResult } from '../../core/create-geo';
import type { LngLat } from '../../core/geo/cells';
import { distanceM } from '../../core/geo/distance';
import { t } from '../../core/i18n/messages';
import type { DirectionStep } from '../../core/route/directions';
import type { Lang } from '../../core/text/types';
import { ARRIVE_M, cueText, dueCue, headingTo, trackRoute, type RouteProgress } from '../../core/route/progress';

export const OFF_ROUTE_FIXES = 2;
export const REROUTE_GAP_MS = 8000;

export type NavFix = { point: LngLat; accuracyM?: number | null; at: number };

export type NavCue = { id: number; text: string };

export type Navigation =
  | { state: 'idle' }
  | { state: 'routing' }
  | { state: 'active'; rerouting: boolean; geometry: LngLat[]; steps: DirectionStep[]; progress: RouteProgress | null; cue: NavCue | null }
  | { state: 'birdseye'; distanceM: number; bearing: number; reason: string; cue: NavCue | null }
  | { state: 'arrived'; cue: NavCue | null };

export type NavigationOptions = {
  directions: (from: LngLat, to: LngLat, options?: { language?: Lang }) => Promise<DirectionsResult>;
  destination: LngLat | null;
  fix: NavFix | null;
  language?: Lang;
  enabled?: boolean;
  now?: () => number;
};

type Route = { geometry: LngLat[]; steps: DirectionStep[]; durationS: number };

export function useNavigation({ directions, destination, fix, language = 'tr', enabled = true, now = Date.now }: NavigationOptions): Navigation {
  const [nav, setNav] = useState<Navigation>({ state: 'idle' });
  const route = useRef<Route | null>(null);
  const along = useRef<number | undefined>(undefined);
  const misses = useRef(0);
  const asked = useRef(0);
  const busy = useRef(false);
  const failed = useRef<string | null>(null);
  const spoken = useRef<{ key: string; level: number }>({ key: '', level: -1 });
  const cueId = useRef(0);
  const lastCue = useRef<NavCue | null>(null);
  const target = destination ? `${destination[0]},${destination[1]}` : '';

  useEffect(() => {
    route.current = null;
    along.current = undefined;
    misses.current = 0;
    failed.current = null;
    spoken.current = { key: '', level: -1 };
    lastCue.current = null;
    setNav(enabled && destination ? { state: 'routing' } : { state: 'idle' });
  }, [target, enabled]);

  useEffect(() => {
    if (!enabled || !destination || !fix) return;
    const speak = (key: string, level: number, text: string): NavCue | null => {
      if (spoken.current.key === key && spoken.current.level >= level) return lastCue.current;
      spoken.current = { key, level };
      cueId.current += 1;
      lastCue.current = { id: cueId.current, text };
      return lastCue.current;
    };

    const ask = (rerouting: boolean) => {
      if (busy.current) return;
      busy.current = true;
      asked.current = now();
      if (rerouting && route.current) setNav((current) => (current.state === 'active' ? { ...current, rerouting: true } : current));
      void directions(fix.point, destination, { language })
        .then((result) => {
          if (result.ok) {
            route.current = { geometry: result.geometry, steps: result.steps, durationS: result.durationS };
            failed.current = null;
          } else {
            route.current = null;
            failed.current = result.code;
          }
        })
        .catch(() => {
          route.current = null;
          failed.current = 'error';
        })
        .finally(() => {
          busy.current = false;
          along.current = undefined;
          misses.current = 0;
          update();
        });
    };

    const update = () => {
      const current = route.current;
      if (!current) {
        if (failed.current === null) return;
        const away = distanceM(fix.point, destination);
        if (away <= ARRIVE_M) setNav({ state: 'arrived', cue: speak('arrive', 2, t(language, 'turn.arrive')) });
        else setNav({ state: 'birdseye', distanceM: away, bearing: headingTo(fix.point, destination), reason: failed.current, cue: lastCue.current });
        return;
      }
      const progress = trackRoute({ ...current, point: fix.point, accuracyM: fix.accuracyM ?? null, ...(along.current === undefined ? {} : { lastAlongM: along.current }) });
      if (progress.arrived) {
        const last = current.steps[current.steps.length - 1];
        setNav({ state: 'arrived', cue: last ? speak('arrive', 2, last.action) : lastCue.current });
        return;
      }
      if (progress.offRoute) {
        misses.current += 1;
        if (misses.current >= OFF_ROUTE_FIXES && now() - asked.current >= REROUTE_GAP_MS) ask(true);
      } else {
        misses.current = 0;
        along.current = progress.alongM;
      }
      let cue = lastCue.current;
      if (progress.next && !progress.offRoute) {
        const key = `${progress.next.kind}@${Math.round(progress.next.atM)}`;
        const level = dueCue(progress.toNextM, spoken.current.key === key ? spoken.current.level : -1);
        if (level !== null) cue = speak(key, level, cueText(progress.next, progress.toNextM, level, language));
      }
      setNav({ state: 'active', rerouting: busy.current, geometry: current.geometry, steps: current.steps, progress, cue });
    };

    if (!route.current && failed.current === null) ask(false);
    else if (!route.current && failed.current !== null && now() - asked.current >= REROUTE_GAP_MS * 4) ask(false);
    else update();
  }, [fix?.at, target, enabled]);

  return nav;
}
