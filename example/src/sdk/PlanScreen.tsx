import { Camera, Images, Map, type PressEvent } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { useRef } from 'react';
import type { NativeSyntheticEvent } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import { MAP_ICON_IMAGES, PlanStopList, RoutePlanLayer, usePlan, useMapStyle } from '../../../src/native';
import { PLAN_STOPS } from '../sdk-test/plan-stops';
import { Chip, Row, usePalette } from './ui';

const ISTANBUL: [number, number] = [29.0287, 40.9903];

export function PlanScreen({ lang, theme }: { lang: string; theme: 'light' | 'dark' }) {
  const palette = usePalette();
  const style = useMapStyle({ theme, language: lang });
  const controls = usePlan();
  const started = useRef(0);

  const press = (event: NativeSyntheticEvent<PressEvent>) => {
    const { lngLat } = event.nativeEvent;
    controls.addStop([lngLat[0], lngLat[1]]);
  };

  const here = async (): Promise<[number, number] | null> => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    const position = await Location.getCurrentPositionAsync({});
    return [position.coords.longitude, position.coords.latitude];
  };

  const sample = () => {
    controls.clear();
    PLAN_STOPS.forEach((point, i) => controls.addStop(point, `Durak ${i + 1}`));
  };

  const sortTimed = async () => {
    started.current = Date.now();
    await controls.sort();
  };

  return (
    <View style={styles.page}>
      <Map style={styles.map} mapStyle={style as never} attribution={false} logo={false} onPress={press}>
        <Images images={MAP_ICON_IMAGES} />
        <Camera initialViewState={{ center: ISTANBUL, zoom: 11 }} />
        <RoutePlanLayer state={controls.state} result={controls.result} nextLeg={controls.nextLeg} theme={theme} />
      </Map>
      <View style={[styles.sheet, { backgroundColor: palette.bg, borderColor: palette.line }]}>
        <Row>
          <Chip label="30 örnek durak" onPress={sample} />
          <Chip label="Başlangıç: konumum" onPress={() => void here().then((point) => point && controls.setStart(null, point))} />
          <Chip label="Temizle" onPress={controls.clear} />
        </Row>
        <PlanStopList controls={{ ...controls, sort: async () => { await sortTimed(); return controls.result ?? ({ ok: false, code: 'INVALID_REQUEST' } as never); } }} lang={lang} dark={theme === 'dark'} onCurrentPosition={here} />
        {controls.result && controls.result.ok ? <Text style={{ color: palette.mute, fontSize: 11 }}>{`${controls.result.strategy}, ${Date.now() - started.current} ms sıralama sonrası`}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  map: { flex: 1 },
  sheet: { padding: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
});
