import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_THEME, type GeoTheme } from '../map/theme';
import { createGeoNative, type GeoNative, type GeoNativeConfig } from '../platform/create';

const GeoContext = createContext<GeoNative | null>(null);
const ThemeContext = createContext<GeoTheme>(DEFAULT_THEME);

function useThemeWarnings(theme: GeoTheme): void {
  useEffect(() => {
    if (typeof __DEV__ !== 'undefined' && __DEV__ && theme.warnings.length > 0) console.warn(`@yuksi/geo theme: ${theme.warnings.join(', ')}`);
  }, [theme]);
}

export function GeoProvider({ config, children, fallback = null, onError, theme = DEFAULT_THEME }: { config: GeoNativeConfig; children: ReactNode; fallback?: ReactNode; onError?: (error: unknown) => void; theme?: GeoTheme }) {
  useThemeWarnings(theme);
  const [geo, setGeo] = useState<GeoNative | null>(null);

  useEffect(() => {
    let alive = true;
    let created: GeoNative | null = null;
    createGeoNative(config).then(
      (value) => {
        created = value;
        if (alive) setGeo(value);
        else void value.dispose();
      },
      (error) => onError?.(error),
    );
    return () => {
      alive = false;
      setGeo(null);
      void created?.dispose();
    };
  }, [config.manifestUrl]);

  return (
    <ThemeContext.Provider value={theme}>
      <GeoContext.Provider value={geo}>{geo ? children : fallback}</GeoContext.Provider>
    </ThemeContext.Provider>
  );
}

export function GeoInstanceProvider({ geo, children, theme = DEFAULT_THEME }: { geo: GeoNative; children: ReactNode; theme?: GeoTheme }) {
  useThemeWarnings(theme);
  return (
    <ThemeContext.Provider value={theme}>
      <GeoContext.Provider value={geo}>{children}</GeoContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useGeo(): GeoNative {
  const geo = useContext(GeoContext);
  if (!geo) throw new Error('useGeo must be used below a GeoProvider that has finished starting');
  return geo;
}

export function useGeoTheme(): GeoTheme {
  return useContext(ThemeContext);
}
