import * as Location from 'expo-location';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { RegionConsentSheet, useGeo, useLocationRegion, useRegions } from '../../../src/native';
import { publishRegionProbe } from './region-probe';

type Region = ReturnType<typeof useLocationRegion> & { markGranted: () => void };

const RegionContext = createContext<Region | null>(null);

export function AutoRegion({ children, lang }: { children: ReactNode; lang: string }) {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then((permission) => setGranted(permission.status === 'granted'));
  }, []);
  const region = useLocationRegion({ granted });
  const geo = useGeo();
  const { regions, statusOf } = useRegions();
  useEffect(() => {
    publishRegionProbe({ location: region.location, action: region.decision.action, installed: geo.regions.installed(), waiting: regions.filter((item) => statusOf(item.id).waitingWifi).map((item) => item.id), remove: (id) => geo.regions.remove(id) });
    return () => publishRegionProbe(null);
  }, [geo, regions, statusOf, region.location, region.decision.action]);
  const markGranted = useCallback(() => setGranted(true), []);
  const value = useMemo(() => ({ ...region, markGranted }), [region, markGranted]);
  return (
    <RegionContext.Provider value={value}>
      {children}
      <RegionConsentSheet decision={region.decision} lang={lang} onAllow={() => void region.accept()} onWait={() => void region.waitForWifi()} />
    </RegionContext.Provider>
  );
}

export function useAutoRegionState(): Region {
  const region = useContext(RegionContext);
  if (!region) throw new Error('AutoRegion is missing above this screen');
  return region;
}
