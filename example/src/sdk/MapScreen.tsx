import { Camera, Images, Map, Marker, type CameraRef, type PressEvent, type ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import { distanceM } from '../../../src/core/geo/distance';
import type { Coverage, Lang, Place } from '../../../src/core';
import { t } from '../../../src/core';
import { CompassButton, DEFAULT_PITCH, GeoHoodLabels, GeoUserLocation, LocateButton, ScaleBar, MAP_ICON_IMAGES, MapLegend, RegionDownloadSheet, useDailyUpdateCheck, useGeo, useLocateMe, useMapStyle, useRegions, type MapView, type ViewPoint } from '../../../src/native';
import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Showing } from './SearchScreen';
import { useAutoRegionState } from './AutoRegion';
import { savedPoints, type SavedPoint } from './saved';
import { Chip, Row, usePalette } from './ui';

const ISTANBUL: [number, number] = [29.0287, 40.9903];
const LANGS = ['tr', 'en', 'de', 'ar', 'ru', 'el'];

export type Pending = { place: Place; street?: string; houseNumber?: string };

const RUSH_HOUR = Date.UTC(2026, 10, 9, 5, 30);
type Picked = { point: [number, number]; reverse: Place | null; ms: number; coverage: Coverage | null };

export function MapScreen({ visible, lang, onLang, theme, onTheme, pending, clearPending, showing, clearShowing }: { visible: boolean; lang: string; onLang: (lang: string) => void; theme: 'light' | 'dark'; onTheme: (theme: 'light' | 'dark') => void; pending: Pending | null; clearPending: () => void; showing: Showing | null; clearShowing: () => void }) {
  const geo = useGeo();
  useDailyUpdateCheck();
  const palette = usePalette();
  const [hidden, setHidden] = useState<string[]>([]);
  const [mapView, setMapView] = useState<ViewPoint>({ center: ISTANBUL, zoom: 12 });
  const [trafficMode, setTrafficMode] = useState(0);
  const style = useMapStyle({ theme, language: lang, hide: hidden, view: mapView, ...(trafficMode === 1 ? { traffic: true } : trafficMode === 2 ? { traffic: RUSH_HOUR } : {}) });
  const { regions } = useRegions();
  const camera = useRef<CameraRef>(null);
  const view = useRef<MapView>({ center: ISTANBUL, zoom: 12, pitch: DEFAULT_PITCH });
  const [tilt, setTilt] = useState(true);
  const [bearing, setBearing] = useState(0);
  const [shown, setShown] = useState<{ zoom: number; latitude: number }>({ zoom: 12, latitude: ISTANBUL[1] });
  const [sheet, setSheet] = useState(false);
  const [legend, setLegend] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [message, setMessage] = useState('');
  const [granted, setGranted] = useState(false);
  const locate = useLocateMe({ cameraRef: camera, getZoom: () => view.current.zoom, granted, onDenied: () => Alert.alert(t(lang, 'locate.denied'), undefined, [{ text: t(lang, 'sheet.close'), style: 'cancel' }, { text: t(lang, 'locate.settings'), onPress: () => locateRef.current?.openSettings() }]), onUnavailable: () => setMessage('Konum şu an alınamıyor') });

  const locateRef = useRef(locate);
  locateRef.current = locate;
  const { decision, accept, dismiss, markGranted } = useAutoRegionState();
  useEffect(() => {
    if (locate.permission === 'granted') markGranted();
  }, [locate.permission, markGranted]);

  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then((permission) => setGranted(permission.status === 'granted'));
  }, []);
  const [saved, setSaved] = useState<SavedPoint[]>([]);

  useEffect(() => {
    if (visible) setSaved(savedPoints(geo.learn.export()));
  }, [geo, visible, message]);

  useEffect(() => {
    if (!visible || !showing) return undefined;
    view.current = { ...view.current, center: showing.point, zoom: 17 };
    const timer = setTimeout(() => camera.current?.flyTo({ center: showing.point, zoom: 17, duration: 500 }), 350);
    return () => clearTimeout(timer);
  }, [visible, showing]);

  useEffect(() => {
    setPicked(null);
    setMessage(pending ? `Doğru noktayı haritada seç: ${pending.place.label}${pending.street ? ` (${pending.street}${pending.houseNumber ? ` No:${pending.houseNumber}` : ''})` : ''}` : '');
    if (pending) view.current = { ...view.current, center: pending.place.coordinate, zoom: 17 };
  }, [pending]);

  useEffect(() => {
    if (!visible || !pending) return undefined;
    const timer = setTimeout(() => camera.current?.flyTo({ center: pending.place.coordinate, zoom: 17, duration: 500 }), 350);
    return () => clearTimeout(timer);
  }, [visible, pending]);

  const moved = (event: NativeSyntheticEvent<ViewStateChangeEvent>) => {
    const { center, zoom, bearing, pitch } = event.nativeEvent;
    view.current = { center: [center[0], center[1]], zoom, bearing, pitch };
    setTilt(pitch > 1);
    setBearing(bearing ?? 0);
    setShown({ zoom, latitude: center[1] });
    setMapView((previous) => {
      const next: ViewPoint = { center: [Math.round(center[0] * 100) / 100, Math.round(center[1] * 100) / 100], zoom: Math.round(zoom * 2) / 2 };
      return previous.center[0] === next.center[0] && previous.center[1] === next.center[1] && previous.zoom === next.zoom ? previous : next;
    });
  };

  const styleKey = useMemo(() => `${theme}|${lang}|${Object.keys(style.sources).join(',')}`, [theme, lang, style]);

  const press = async (event: NativeSyntheticEvent<PressEvent>) => {
    const { lngLat } = event.nativeEvent;
    const point: [number, number] = [lngLat[0], lngLat[1]];
    const started = performance.now();
    const reverse = await geo.search.reverse(point, { language: lang as Lang });
    const coverage = await geo.search.coverage(point);
    setPicked({ point, reverse, ms: performance.now() - started, coverage });
    if (!pending) setMessage('');
  };

  const confirm = async () => {
    if (!pending || !picked) return;
    const result = await geo.learn.confirm({ place: pending.place, ...(pending.street ? { street: pending.street } : {}), ...(pending.houseNumber ? { houseNumber: pending.houseNumber } : {}), point: picked.point, source: 'pin' });
    setMessage(result.ok ? `Kaydedildi (${result.trusted ? 'güvenilir' : 'tek onay'}, ${result.count} onay)` : `Kaydedilemedi: ${result.reason}`);
    if (result.ok) {
      clearPending();
      setPicked(null);
    }
  };

  const askLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return setMessage('Konum izni verilmedi');
    const position = await Location.getCurrentPositionAsync({});
    const point: [number, number] = [position.coords.longitude, position.coords.latitude];
    camera.current?.flyTo({ center: point, zoom: 13, duration: 600 });
    const here = geo.regions.detect(point);
    const area = await geo.search.coverage(point);
    setMessage(`Konum alındı. İl: ${here.region ?? 'bulunamadı'}${here.nearBorder.length ? `, sınıra yakın: ${here.nearBorder.join(', ')}` : ''}${area?.level === 'sparse' ? `. ${t(lang, 'coverage.sparse', { district: area.district, streets: area.streets, addresses: area.addresses })}` : ''}`);
  };

  const nameOf = (id: string) => regions.find((r) => r.id === id)?.names[lang] ?? regions.find((r) => r.id === id)?.names.tr ?? id;
  const first = decision.action === 'suggest' ? (decision.regions[0] ?? decision.neighbours[0]) : decision.neighbours[0];
  const suggestion = first ? (decision.action === 'suggest' && decision.regions[0] ? t(lang, 'suggest.region', { name: nameOf(first) }) : t(lang, 'suggest.neighbour', { name: nameOf(first) })) : null;

  return (
    <View style={styles.page}>
      <Map key={styleKey} style={styles.map} mapStyle={style as never} attribution={false} logo={false} onPress={press} onRegionDidChange={moved}>
        <Images images={MAP_ICON_IMAGES} />
        <Camera ref={camera} initialViewState={view.current} {...locate.camera} />
        <GeoUserLocation {...locate.puck} />
        <GeoHoodLabels theme={theme} language={lang} />
        {pending && !picked ? (
          <Marker lngLat={pending.place.coordinate}>
            <View style={styles.old} />
          </Marker>
        ) : null}
        {saved.map((item) => (
          <Marker key={item.key} lngLat={item.point}>
            <View style={styles.saved} />
          </Marker>
        ))}
        {showing ? (
          <Marker lngLat={showing.point}>
            <View style={styles.shown} />
          </Marker>
        ) : null}
        {picked ? (
          <Marker lngLat={picked.point}>
            <View style={styles.pin} />
          </Marker>
        ) : null}
      </Map>
      <CompassButton style={styles.compass} bearing={bearing} lang={lang} onPress={() => camera.current?.easeTo({ center: view.current.center, bearing: 0, pitch: view.current.pitch ?? DEFAULT_PITCH, duration: 400 })} />
      <View style={styles.scale} pointerEvents="none">
        <ScaleBar zoom={shown.zoom} latitude={shown.latitude} lang={lang} />
      </View>
      <LocateButton style={styles.locate} mode={locate.mode} permission={locate.permission} busy={locate.busy} onPress={() => void locate.press()} lang={lang} />
      <View style={styles.top}>
        <Row>
          <Chip label={t(lang, 'sheet.title')} onPress={() => setSheet(true)} />
          <Chip label={theme === 'light' ? 'Koyu tema' : 'Açık tema'} onPress={() => onTheme(theme === 'light' ? 'dark' : 'light')} />
          <Chip label={tilt ? `Eğim ${Math.round(view.current.pitch ?? DEFAULT_PITCH)}°` : 'Eğim 0°'} active={tilt} onPress={() => camera.current?.easeTo({ center: view.current.center, pitch: tilt ? 0 : DEFAULT_PITCH, duration: 400 })} />
          <Chip label="Konumum" onPress={() => void askLocation()} />
          <Chip label={t(lang, 'legend.button')} onPress={() => setLegend(true)} />
          <Chip label={['Trafik kapalı', 'Trafik şimdi', 'Trafik yoğun saat'][trafficMode] as string} active={trafficMode > 0} onPress={() => setTrafficMode((trafficMode + 1) % 3)} />
        </Row>
        <Row>
          {LANGS.map((code) => (
            <Chip key={code} label={code} active={code === lang} onPress={() => onLang(code)} />
          ))}
        </Row>
      </View>
      {showing && !suggestion && !picked ? (
        <View style={[styles.panel, { backgroundColor: palette.card }]}>
          <Text style={{ color: palette.fg, fontWeight: '600' }}>{showing.label}</Text>
          <Text style={{ color: palette.mute, fontSize: 12 }}>{`${showing.point[1].toFixed(5)}, ${showing.point[0].toFixed(5)}`}</Text>
          <Row>
            <Pressable onPress={clearShowing} style={styles.action}>
              <Text style={styles.actionText}>Kapat</Text>
            </Pressable>
          </Row>
        </View>
      ) : null}
      {suggestion ? (
        <View style={[styles.panel, { backgroundColor: palette.card }]}>
          <Text style={{ color: palette.fg }}>{suggestion}</Text>
          <Row>
            <Pressable onPress={() => void accept(first ? [first] : [])} style={styles.action}>
              <Text style={styles.actionText}>{t(lang, 'suggest.accept')}</Text>
            </Pressable>
            <Pressable onPress={() => void dismiss(first ? [first] : [])} style={styles.action}>
              <Text style={styles.actionText}>{t(lang, 'suggest.dismiss')}</Text>
            </Pressable>
          </Row>
        </View>
      ) : picked || message ? (
        <View style={[styles.panel, { backgroundColor: palette.card }]}>
          {message ? <Text style={{ color: palette.fg }}>{message}</Text> : null}
          {picked ? (
            <>
              <Text style={{ color: palette.fg, fontWeight: '600' }}>{picked.reverse ? picked.reverse.label : 'Bu noktada kayıtlı adres yok'}</Text>
              <Text style={{ color: palette.mute, fontSize: 12 }}>
                {picked.reverse ? `${picked.reverse.precision}, ${picked.reverse.approximate ? 'yaklaşık' : 'kesin'}, ${picked.reverse.source}, ` : ''}
                {`${picked.point[1].toFixed(5)}, ${picked.point[0].toFixed(5)}, ${picked.ms.toFixed(0)} ms`}
              </Text>
              {picked.coverage?.level === 'sparse' ? <Text style={{ color: palette.bad, fontSize: 12 }}>{t(lang, 'coverage.sparse', { district: picked.coverage.district, streets: picked.coverage.streets, addresses: picked.coverage.addresses })}</Text> : null}
              {pending ? (
                <>
                  <Text style={{ color: palette.mute, fontSize: 12 }}>{`Adresin eski noktasına uzaklık: ${Math.round(distanceM(pending.place.coordinate, picked.point))} m`}</Text>
                  <Row>
                    <Pressable onPress={() => void confirm()} style={styles.action}>
                      <Text style={styles.actionText}>Burayı onayla</Text>
                    </Pressable>
                    <Pressable onPress={clearPending} style={styles.action}>
                      <Text style={styles.actionText}>Vazgeç</Text>
                    </Pressable>
                  </Row>
                </>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
      <MapLegend visible={legend} onClose={() => setLegend(false)} lang={lang} hidden={hidden} onToggle={(token) => setHidden((previous) => (previous.includes(token) ? previous.filter((item) => item !== token) : [...previous, token]))} />
      <RegionDownloadSheet visible={sheet} onClose={() => setSheet(false)} lang={lang} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  map: { flex: 1 },
  top: { position: 'absolute', top: Platform.OS === 'ios' ? 56 : 28, left: 8, right: 8, gap: 6 },
  locate: { position: 'absolute', right: 12, top: Platform.OS === 'ios' ? 176 : 148 },
  compass: { position: 'absolute', right: 12, top: Platform.OS === 'ios' ? 228 : 200 },
  scale: { position: 'absolute', left: 12, bottom: 110 },
  panel: { position: 'absolute', left: 8, right: 8, bottom: 40, borderRadius: 12, padding: 12, gap: 6 },
  action: { backgroundColor: '#ff5b04', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { color: '#fff', fontWeight: '600' },
  old: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#1565c0', borderWidth: 3, borderColor: '#fff' },
  pin: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#ff5b04', borderWidth: 3, borderColor: '#fff' },
  saved: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#2e7d32', borderWidth: 2, borderColor: '#fff' },
  shown: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#d81b60', borderWidth: 3, borderColor: '#fff' },
});
