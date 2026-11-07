import { Camera, GeoJSONSource, Images, Layer, Map, type MapRef, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Location from 'expo-location';
import { GeoHoodLabels, GeoInstanceProvider, GeoUserLocation, type GeoNative, type ViewPoint, MAP_ICON_IMAGES, RoutePlanLayer, safeView, useLocateMe, useMapStyle, usePlan } from '../../../../src/native';
import { destination } from '../sim/driving';
import { attachHandle, subscribeTour, tourState, type Car, type Frame, type Look, type MapFeature, type View as MapView } from './driver';

const PLAN_LAYERS = ['hood-labels', 'geo-plan-line', 'geo-plan-dot', 'geo-plan-number', 'geo-sim-car', 'geo-sim-heading'];
const START: MapView = { center: [29.0287, 40.9903], zoom: 12 };

const pose = (view: MapView) => safeView({ center: view.center, zoom: view.zoom, ...(view.bearing === undefined ? {} : { bearing: view.bearing }), ...(view.pitch === undefined ? {} : { pitch: view.pitch }) });

function frameStyle(frame: Frame, width: number, height: number) {
  if (frame === 'landscape') return { position: 'absolute' as const, width: height, height: width, left: (width - height) / 2, top: (height - width) / 2, transform: [{ rotate: '90deg' }] };
  if (frame === 'half') return { position: 'absolute' as const, left: 0, right: 0, top: 0, height: height / 2 };
  if (frame === 'square') return { position: 'absolute' as const, left: 0, top: 0, width, height: width };
  return { position: 'absolute' as const, left: 0, right: 0, top: 0, bottom: 0 };
}

const NOTHING = { type: 'FeatureCollection', features: [] };

function carFeatures(car: Car) {
  if (!car) return { dot: NOTHING, nose: NOTHING };
  const nose = destination(car.point, car.heading, 28);
  return {
    dot: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: car.point } }] },
    nose: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [car.point, nose] } }] },
  };
}

function TourMap({ look, car }: { look: Look; car: Car }) {
  const cars = useMemo(() => carFeatures(car), [car]);
  const [viewPoint, setViewPoint] = useState<ViewPoint>({ center: START.center, zoom: START.zoom });
  const style = useMapStyle({ theme: look.theme, language: look.lang, ...(look.font ? { font: look.font } : {}), ...(look.hide && look.hide.length > 0 ? { hide: look.hide } : {}), ...(look.window ? { view: viewPoint } : {}), ...(look.traffic !== undefined ? { traffic: look.traffic } : {}) });
  const plan = usePlan();
  const planRef = useRef(plan);
  planRef.current = plan;
  const [granted, setGranted] = useState(false);
  const zoom = useRef(12);
  const map = useRef<MapRef>(null);
  const camera = useRef<CameraRef>(null);
  const locate = useLocateMe({ cameraRef: camera, getZoom: () => zoom.current, granted, onDenied: () => mark('locate-denied'), onUnavailable: () => mark('locate-unavailable') });
  const locateRef = useRef(locate);
  locateRef.current = locate;
  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then((permission) => setGranted(permission.status === 'granted'));
  }, []);
  const counters = useRef({ frames: 0 });
  const events = useRef<string[]>([]);
  const loadedKey = useRef('');
  const keyRef = useRef('');
  const live = (): MapRef => {
    if (loadedKey.current !== keyRef.current || !map.current) throw new Error('harita hazır değil');
    return map.current;
  };
  const mark = (name: string): void => {
    events.current = [...events.current.slice(-30), `${name}@${Date.now() % 100000}`];
  };
  const size = useRef({ width: 0, height: 0 });
  const styleRef = useRef(style);
  styleRef.current = style;
  const styleKey = useMemo(() => `${look.theme}|${look.lang}|${look.font ?? 'noto'}${look.bare ? '|bare' : ''}${look.window ? '|window' : ''}${look.traffic !== undefined ? `|traffic${look.traffic}` : ''}|${(look.hide ?? []).join(',')}`, [look.theme, look.lang, look.font, look.bare, look.window, look.hide]);
  const shown = useMemo(() => (look.bare ? { ...style, layers: style.layers.filter((layer) => layer.type !== 'symbol') } : style), [style, look.bare]);

  useEffect(() => {
    counters.current = { frames: 0 };
    keyRef.current = styleKey;
    mark(`mount:${styleKey}`);
    attachHandle({
      frames: () => counters.current.frames,
      events: () => events.current,
      size: () => size.current,
      layerIds: (prefix) => [...styleRef.current.layers.map((layer) => layer.id), ...PLAN_LAYERS].filter((id) => id.startsWith(prefix)),
      fly: (next, duration) => camera.current?.flyTo({ ...pose(next), duration }),
      jump: (next) => camera.current?.jumpTo(pose(next)),
      view: async () => {
        const state = await live().getViewState();
        return { center: [state.center[0], state.center[1]], zoom: state.zoom, bearing: state.bearing, pitch: state.pitch };
      },
      query: async (layers) => (await live().queryRenderedFeatures(layers ? { layers } : {})) as unknown as MapFeature[],
      project: async (point) => {
        const pixel = await live().project(point);
        return [pixel[0], pixel[1]];
      },
      unproject: async (pixel) => {
        const point = await live().unproject(pixel);
        return [point[0], point[1]];
      },
      plan: () => planRef.current,
      locate: { press: () => locateRef.current.press(), stop: () => locateRef.current.stop(), state: () => ({ mode: locateRef.current.mode, permission: locateRef.current.permission }) },
    });
    return () => attachHandle(null);
  }, [styleKey]);

  return (
    <Map
      key={styleKey}
      ref={map}
      style={styles.map}
      mapStyle={shown as never}
      attribution={false}
      logo={false}
      onLayout={(event) => {
        size.current = { width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height };
      }}
      onWillStartLoadingMap={() => mark('start')}
      onDidFinishLoadingStyle={() => mark('style')}
      onDidFinishLoadingMap={() => {
        loadedKey.current = styleKey;
        mark('loaded');
      }}
      onDidFailLoadingMap={() => mark('FAILED')}
      onRegionDidChange={(event) => {
        zoom.current = event.nativeEvent.zoom;
        if (look.window) setViewPoint({ center: [event.nativeEvent.center[0], event.nativeEvent.center[1]], zoom: event.nativeEvent.zoom });
      }}
      onDidFinishRenderingFrameFully={() => {
        loadedKey.current = styleKey;
        counters.current.frames += 1;
      }}
    >
      <Images images={MAP_ICON_IMAGES} />
      <Camera ref={camera} initialViewState={START} {...locate.camera} />
      <GeoUserLocation {...locate.puck} />
      {look.bare ? null : <GeoHoodLabels theme={look.theme} language={look.lang} {...(look.font ? { font: look.font } : {})} />}
      <GeoJSONSource id="geo-sim-car-source" data={cars.dot as never}>
        <Layer id="geo-sim-car" type="circle" paint={{ 'circle-radius': 9, 'circle-color': '#e8590c', 'circle-stroke-width': 3, 'circle-stroke-color': '#ffffff' }} />
      </GeoJSONSource>
      <GeoJSONSource id="geo-sim-heading-source" data={cars.nose as never}>
        <Layer id="geo-sim-heading" type="line" layout={{ 'line-cap': 'round' }} paint={{ 'line-color': '#e8590c', 'line-width': 4 }} />
      </GeoJSONSource>
      <RoutePlanLayer state={plan.state} result={plan.result} nextLeg={plan.nextLeg} theme={look.theme} />
    </Map>
  );
}

export function MapTourOverlay() {
  const state = useSyncExternalStore(subscribeTour, tourState);
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(state.geo !== null), [state.geo]);
  const { width, height } = useWindowDimensions();
  if (!state.geo || !shown) return null;
  return (
    <View style={styles.cover}>
      <View style={frameStyle(state.frame, width, height)}>
        <GeoInstanceProvider geo={state.geo as GeoNative}>
          <TourMap look={state.look} car={state.car} />
        </GeoInstanceProvider>
      </View>
      <View style={styles.banner} pointerEvents="none">
        <Text style={styles.text}>{state.status}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff', zIndex: 50 },
  map: { flex: 1 },
  banner: { position: 'absolute', top: 54, left: 12, right: 12, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 10, padding: 10 },
  text: { color: '#fff', fontSize: 13 },
});
