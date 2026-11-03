import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme } from 'react-native';
import type { Lang } from '../../core/text/types';
import type { RegionStatus } from '../../core/packs/manager';
import type { AutoDecision } from '../../core/packs/region';
import type { ManifestRegion } from '../../core/region/manifest';
import { nextAttribution, type AttributionState } from '../logic/attribution';
import { createAutoRegion } from '../logic/auto-region';
import { createCoalescer } from '../logic/coalesce';
import { resolveScheme, type ThemePreference } from '../logic/scheme';
import { hereText, type PlaceCardData } from '../logic/place-card';
import { loadPlaceCard, type MapFeature } from '../logic/place-pick-load';
import type { NearbyHit } from '../../core/address/search';
import type { NearbyGroup } from '../../core/address/nearby';
import type { MapFont, MapStyle } from '../map/style';
import { MAX_STYLED_REGIONS, regionsForView, type ViewPoint } from '../map/region-window';
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

export type MapStyleHookOptions = { theme: ThemePreference; language?: string; hide?: string[]; look?: MapLook; view?: ViewPoint; maxRegions?: number; font?: MapFont };

export function useMapStyle(given: MapStyleHookOptions): MapStyle {
  const system = useColorScheme();
  const theme = resolveScheme(given.theme, system);
  const options = { ...given, theme };
  const geo = useGeo();
  const geoTheme = useGeoTheme();
  const lookKey = JSON.stringify(options.look ?? null);
  const side = geoTheme[options.theme];
  const look = useMemo(() => resolveMapLook(side.map, options.look), [side, lookKey]);
  useRegionTick();
  const installed = geo.regions.installed().join(',') + '|' + (geo.regions.baseDir() ?? '');
  const hideKey = (options.hide ?? []).join(',');
  const current = useRef<string[] | null>(null);
  if (options.view === undefined) current.current = null;
  else {
    const installedIds = geo.regions.installed();
    const regions = geo.regions.list().filter((region) => installedIds.includes(region.id)).map((region) => ({ id: region.id, bbox: region.bbox }));
    current.current = regionsForView(options.view, regions, current.current, { max: options.maxRegions ?? MAX_STYLED_REGIONS });
  }
  const only = current.current;
  const onlyKey = only === null ? '*' : only.join(',');
  return useMemo(() => geo.map.style({ theme: options.theme, ...(options.language ? { language: options.language } : {}), ...(options.hide ? { hide: options.hide } : {}), ...(only ? { only } : {}), look, accent: side.colors.accent, ...(options.font ? { font: options.font } : {}) }), [geo, options.theme, options.language, options.font, hideKey, installed, onlyKey, look, side]);
}

export function useHoodLabels(language?: string): { name: string; lng: number; lat: number }[] {
  const geo = useGeo();
  useRegionTick();
  const installed = geo.regions.installed().join(',');
  const [hoods, setHoods] = useState<{ name: string; lng: number; lat: number }[]>([]);
  useEffect(() => {
    let alive = true;
    geo.search.hoods(language as Lang).then(
      (labels) => alive && setHoods(labels),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [geo, installed, language]);
  return hoods;
}

type AutoRegionControls = {
  decision: AutoDecision;
  accept: (ids?: string[]) => Promise<void>;
  waitForWifi: (ids?: string[]) => Promise<void>;
  dismiss: (ids?: string[]) => Promise<void>;
  refresh: () => void;
};

export function useAutoRegion(location: [number, number] | null | undefined): AutoRegionControls {
  const geo = useGeo();
  const tick = useRegionTick();
  const [decision, setDecision] = useState<AutoDecision>({ action: 'none', regions: [], neighbours: [] });
  const [connectionTick, setConnectionTick] = useState(0);
  const [refreshTick, setRefreshTick] = useState(0);
  const make = () =>
    createAutoRegion({
      suggest: async (point) => geo.regions.suggest(point, { connection: await geo.regions.connection().catch(() => 'unknown' as const) }),
      download: (id) => geo.regions.download(id),
      now: () => Date.now(),
      retryMs: RETRY_MS,
    });
  const auto = useRef(make());

  useEffect(() => {
    auto.current = make();
  }, [geo]);

  useEffect(() => geo.regions.onConnection(() => setConnectionTick((value) => value + 1)), [geo]);

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
  }, [geo, lng, lat, tick, connectionTick, refreshTick]);

  const chosen = (ids: string[] | undefined): string[] => ids ?? (decision.action === 'consent' ? decision.regions : [...decision.regions, ...decision.neighbours]);
  const accept = useCallback(async (ids?: string[]) => void (await Promise.allSettled(chosen(ids).map((id) => geo.regions.download(id, { allowCellular: true })))), [geo, decision]);
  const waitForWifi = useCallback(async (ids?: string[]) => void (await Promise.allSettled(chosen(ids).map((id) => geo.regions.download(id, { wifiOnly: true })))), [geo, decision]);
  const dismiss = useCallback(
    async (ids?: string[]) => {
      for (const id of ids ?? [...decision.regions, ...decision.neighbours]) await geo.regions.dismiss(id);
      setDecision((current) => ({ ...current, regions: current.regions.filter((id) => !(ids ?? current.regions).includes(id)), neighbours: current.neighbours.filter((id) => !(ids ?? current.neighbours).includes(id)) }));
    },
    [geo, decision],
  );
  const refresh = useCallback(() => setRefreshTick((value) => value + 1), []);
  return { decision, accept, waitForWifi, dismiss, refresh };
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

export function useHereLabel(point: [number, number] | null, language?: string, delayMs = 1500): string | null {
  const geo = useGeo();
  const [text, setText] = useState<string | null>(null);
  const lang = language ?? 'tr';
  const key = point ? `${point[0].toFixed(4)},${point[1].toFixed(4)}` : '';
  useEffect(() => {
    if (!point) {
      setText(null);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      geo.search.reverse(point, { language: lang as Lang }).then(
        (place) => live && setText(hereText(place, lang)),
        () => live && setText(null),
      );
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [geo, key, lang, delayMs]);
  return text;
}

export function usePlaceAt(project: (point: [number, number]) => Promise<[number, number]> | [number, number], language?: string): { card: PlaceCardData | null; pick(features: readonly MapFeature[], tap: { x: number; y: number }): Promise<PlaceCardData | null>; close(): void } {
  const geo = useGeo();
  const [card, setCard] = useState<PlaceCardData | null>(null);
  const lang = language ?? 'tr';
  const pick = useCallback(
    async (features: readonly MapFeature[], tap: { x: number; y: number }) => {
      const found = await loadPlaceCard({ project, reverse: (point) => geo.search.reverse(point, { language: lang as Lang }), lang }, features, tap);
      setCard(found);
      return found;
    },
    [geo, project, lang],
  );
  return { card, pick, close: () => setCard(null) };
}

export function useNearby(point: [number, number] | null, group: NearbyGroup | null, options: { limit?: number; radiusM?: number; language?: string } = {}): { hits: NearbyHit[]; loading: boolean } {
  const geo = useGeo();
  const [state, setState] = useState<{ hits: NearbyHit[]; loading: boolean }>({ hits: [], loading: false });
  const key = point && group ? `${point[0].toFixed(4)},${point[1].toFixed(4)}|${group}|${options.limit ?? ''}|${options.radiusM ?? ''}` : '';
  useEffect(() => {
    if (!point || !group) {
      setState({ hits: [], loading: false });
      return undefined;
    }
    let live = true;
    setState((now) => ({ hits: now.hits, loading: true }));
    geo.search.nearby({ point, group, ...(options.limit ? { limit: options.limit } : {}), ...(options.radiusM ? { radiusM: options.radiusM } : {}), ...(options.language ? { language: options.language as Lang } : {}) }).then(
      (hits) => live && setState({ hits, loading: false }),
      () => live && setState({ hits: [], loading: false }),
    );
    return () => {
      live = false;
    };
  }, [geo, key]);
  return state;
}
