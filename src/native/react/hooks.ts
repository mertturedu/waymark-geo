import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lang } from '../../core/text/types';
import type { RegionStatus } from '../../core/packs/manager';
import type { AutoDecision } from '../../core/packs/region';
import type { ManifestRegion } from '../../core/region/manifest';
import { nextAttribution, type AttributionState } from '../logic/attribution';
import { createAutoRegion } from '../logic/auto-region';
import { createCoalescer } from '../logic/coalesce';
import type { MapStyle } from '../map/style';
import { resolveMapLook, type MapLook } from '../map/theme';
import { useGeo, useGeoTheme } from './GeoProvider';

const REFRESH_MS = 200;
const RETRY_MS = 60_000;

const timers = { now: () => Date.now(), set: (run: () => void, ms: number) => setTimeout(run, ms), clear: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle) };

function useRegionTick(): number {
  const geo = useGeo();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const coalescer = createCoalescer(() => setTick((value) => value + 1), REFRESH_MS, timers);
    const off = geo.regions.subscribe(() => coalescer.notify());
    return () => {
      off();
      coalescer.stop();
    };
  }, [geo]);
  return tick;
}

export function useRegions(): { regions: ManifestRegion[]; statusOf: (id: string) => RegionStatus; missingBaseBytes: number } {
  const geo = useGeo();
  const tick = useRegionTick();
  return useMemo(() => ({ regions: geo.regions.list(), statusOf: (id: string) => geo.regions.status(id), missingBaseBytes: geo.regions.missingBaseBytes() }), [geo, tick]);
}

export function useRegionStatus(id: string): RegionStatus {
  const geo = useGeo();
  const tick = useRegionTick();
  return useMemo(() => geo.regions.status(id), [geo, id, tick]);
}

export function useMapStyle(options: { theme: 'light' | 'dark'; language?: string; hide?: string[]; look?: MapLook }): MapStyle {
  const geo = useGeo();
  const geoTheme = useGeoTheme();
  const lookKey = JSON.stringify(options.look ?? null);
  const side = geoTheme[options.theme];
  const look = useMemo(() => resolveMapLook(side.map, options.look), [side, lookKey]);
  useRegionTick();
  const installed = geo.regions.installed().join(',') + '|' + (geo.regions.baseDir() ?? '');
  const hideKey = (options.hide ?? []).join(',');
  const [hoods, setHoods] = useState<{ name: string; lng: number; lat: number }[]>([]);
  useEffect(() => {
    let alive = true;
    geo.search.hoods(options.language as Lang).then(
      (labels) => alive && setHoods(labels),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [geo, installed, options.language]);
  return useMemo(() => geo.map.style({ theme: options.theme, ...(options.language ? { language: options.language } : {}), ...(options.hide ? { hide: options.hide } : {}), hoods, look, accent: side.colors.accent }), [geo, options.theme, options.language, hideKey, installed, hoods, look, side]);
}

export function useAutoRegion(location: [number, number] | null | undefined): { decision: AutoDecision; accept: (ids?: string[]) => Promise<void>; dismiss: (ids?: string[]) => Promise<void> } {
  const geo = useGeo();
  const tick = useRegionTick();
  const [decision, setDecision] = useState<AutoDecision>({ action: 'none', regions: [], neighbours: [] });
  const auto = useRef(createAutoRegion({ suggest: (point) => geo.regions.suggest(point), download: (id) => geo.regions.download(id), now: () => Date.now(), retryMs: RETRY_MS }));

  useEffect(() => {
    auto.current = createAutoRegion({ suggest: (point) => geo.regions.suggest(point), download: (id) => geo.regions.download(id), now: () => Date.now(), retryMs: RETRY_MS });
  }, [geo]);

  const lng = location ? location[0] : null;
  const lat = location ? location[1] : null;
  useEffect(() => {
    let alive = true;
    auto.current.update(lng === null || lat === null ? null : [lng, lat]).then((result) => {
      if (alive) setDecision(result.decision);
    });
    return () => {
      alive = false;
    };
  }, [geo, lng, lat, tick]);

  const accept = useCallback(
    async (ids?: string[]) => {
      const wanted = ids ?? [...decision.regions, ...decision.neighbours];
      await Promise.allSettled(wanted.map((id) => geo.regions.download(id)));
    },
    [geo, decision],
  );
  const dismiss = useCallback(
    async (ids?: string[]) => {
      for (const id of ids ?? [...decision.regions, ...decision.neighbours]) await geo.regions.dismiss(id);
      setDecision((current) => ({ ...current, regions: current.regions.filter((id) => !(ids ?? current.regions).includes(id)), neighbours: current.neighbours.filter((id) => !(ids ?? current.neighbours).includes(id)) }));
    },
    [geo, decision],
  );
  return { decision, accept, dismiss };
}

export function useAttribution(): { state: AttributionState; interact: () => void; toggle: () => void } {
  const [state, setState] = useState<AttributionState>('expanded');
  const interact = useCallback(() => setState((current) => nextAttribution(current, 'interact')), []);
  const toggle = useCallback(() => setState((current) => nextAttribution(current, 'toggle')), []);
  return { state, interact, toggle };
}

export const UPDATE_CHECK_MS = 24 * 3_600_000;

export function useDailyUpdateCheck(minIntervalMs: number = UPDATE_CHECK_MS): void {
  const geo = useGeo();
  useEffect(() => {
    void geo.regions.checkUpdates({ minIntervalMs }).catch(() => undefined);
  }, [geo, minIntervalMs]);
}
