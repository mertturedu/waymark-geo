import { Camera, Map, type StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { packsDirectory } from '../device-test/storage';
import { clearMapEvents, mapEventNames, recordMapEvent, subscribeMapEvents } from './mapEvents';
import { buildOfflineStyle } from './offlineStyle';

const LANGS = ['tr', 'en', 'ar'];
const FILES = ['istanbul-kadikoy.pmtiles', 'istanbul-orta-a.pmtiles', 'istanbul-orta-b.pmtiles', 'istanbul.pmtiles', 'istanbul-flat.pmtiles'];

export function OfflineMapScreen() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [lang, setLang] = useState('tr');
  const [fontNames, setFontNames] = useState<'original' | 'compact'>('original');
  const [file, setFile] = useState(FILES[0] as string);
  const [credit, setCredit] = useState<'text' | 'icon' | 'open'>('text');
  const [events, setEvents] = useState<string[]>([]);

  useEffect(() => {
    clearMapEvents();
    setEvents([]);
  }, [theme, lang, fontNames, file]);

  useEffect(() => subscribeMapEvents(() => setEvents(mapEventNames())), []);

  const style = useMemo(
    () => buildOfflineStyle({ packsDir: packsDirectory().uri, pmtilesFile: file, theme, lang, fontNames }),
    [theme, lang, fontNames, file],
  );

  return (
    <View style={styles.page}>
      <Map
        key={`${theme}-${lang}-${fontNames}-${file}`}
        style={styles.map}
        mapStyle={style as unknown as StyleSpecification}
        attribution={false}
        logo={false}
        onWillStartLoadingMap={() => recordMapEvent('willStartLoadingMap')}
        onDidFinishLoadingMap={() => recordMapEvent('didFinishLoadingMap')}
        onDidFailLoadingMap={() => recordMapEvent('didFailLoadingMap')}
        onDidFinishRenderingMapFully={() => recordMapEvent('didFinishRenderingMapFully')}
        onRegionIsChanging={() => setCredit((previous) => (previous === 'text' ? 'icon' : previous))}
      >
        <Camera initialViewState={{ center: [29.0287, 40.9903], zoom: 14 }} />
      </Map>
      <Pressable style={styles.credit} onPress={() => setCredit((previous) => (previous === 'open' ? 'icon' : 'open'))}>
        <Text style={styles.creditText}>{credit === 'icon' ? 'i' : '© OpenStreetMap contributors'}</Text>
        {credit === 'open' ? (
          <Text style={styles.link} onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright')}>
            openstreetmap.org/copyright
          </Text>
        ) : null}
      </Pressable>
      <View style={styles.bar}>
        <Chip label={theme === 'light' ? 'Koyu tema' : 'Açık tema'} onPress={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
        <Chip label={`Dil: ${lang}`} onPress={() => setLang(LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length] as string)} />
        <Chip label={`Yazı: ${fontNames}`} onPress={() => setFontNames(fontNames === 'original' ? 'compact' : 'original')} />
        <Chip label={file.replace('.pmtiles', '')} onPress={() => setFile(FILES[(FILES.indexOf(file) + 1) % FILES.length] as string)} />
      </View>
      <Text style={styles.events}>{events.length > 0 ? events.join(' > ') : 'olay yok'}</Text>
    </View>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  map: { flex: 1 },
  bar: { position: 'absolute', top: Platform.OS === 'ios' ? 110 : 80, left: 8, right: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: '#fff', fontSize: 12 },
  credit: { position: 'absolute', right: 6, bottom: 6, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, maxWidth: 260 },
  creditText: { fontSize: 11, color: '#333' },
  link: { fontSize: 11, color: '#1565c0', textDecorationLine: 'underline' },
  events: { position: 'absolute', left: 8, bottom: 8, right: 130, fontSize: 10, color: '#fff', backgroundColor: 'rgba(0,0,0,0.5)', padding: 3 },
});
