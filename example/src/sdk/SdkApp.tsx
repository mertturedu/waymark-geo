import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Pending } from './MapScreen';
import { GeoProvider } from '../../../src/native';
import { AutoRegion } from './AutoRegion';
import { MapScreen } from './MapScreen';
import { PlanScreen } from './PlanScreen';
import { SearchScreen, type Showing } from './SearchScreen';
import { SettingsScreen } from './SettingsScreen';
import { PUBLIC_KEY, manifestUrlOf, useServer } from './server';
import { loadSettings, saveSettings, type Settings } from './settings';
import { usePalette } from './ui';

type Inner = 'map' | 'plan' | 'search' | 'settings';

export function SdkApp() {
  const server = useServer();
  const palette = usePalette();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [inner, setInner] = useState<Inner>('map');
  const [pending, setPending] = useState<Pending | null>(null);
  const [showing, setShowing] = useState<Showing | null>(null);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const change = (next: Partial<Settings>) =>
    setSettings((current) => {
      const merged = { ...(current ?? { lang: 'tr', theme: 'light' as const }), ...next };
      saveSettings(merged);
      return merged;
    });

  if (!settings || !server.ready) return <ActivityIndicator style={{ flex: 1 }} />;
  if (!server.url) return <Text style={{ padding: 32, color: palette.fg }}>Paket sunucusu adresi yok. Ayarlardan yaz.</Text>;

  return (
    <GeoProvider config={{ manifestUrl: manifestUrlOf(server.url), publicKeys: PUBLIC_KEY ? [PUBLIC_KEY] : [], language: settings.lang, autoDownload: 'always' }} fallback={<ActivityIndicator style={{ flex: 1 }} />}>
      <AutoRegion lang={settings.lang}>
        <View style={{ flex: 1, backgroundColor: palette.bg }}>
          <View style={[styles.body, inner !== 'map' && styles.hidden]}>
            <MapScreen
              visible={inner === 'map'}
              lang={settings.lang}
              onLang={(lang) => change({ lang })}
              theme={settings.theme}
              onTheme={(theme) => change({ theme })}
              pending={pending}
              clearPending={() => setPending(null)}
              showing={showing}
              clearShowing={() => setShowing(null)}
            />
          </View>
          <View style={[styles.body, inner !== 'plan' && styles.hidden]}>
            {inner === 'plan' ? <PlanScreen lang={settings.lang} theme={settings.theme} /> : null}
          </View>
          <View style={[styles.body, inner !== 'search' && styles.hidden]}>
            <SearchScreen
              lang={settings.lang}
              visible={inner === 'search'}
              onPick={(next) => {
                setShowing(null);
                setPending(next);
                setInner('map');
              }}
              onShow={(next) => {
                setPending(null);
                setShowing(next);
                setInner('map');
              }}
            />
          </View>
          <View style={[styles.body, inner !== 'settings' && styles.hidden]}>
            <SettingsScreen lang={settings.lang} onLang={(lang) => change({ lang })} theme={settings.theme} onTheme={(theme) => change({ theme })} server={server.url} onServer={server.set} serverNote={server.note} />
          </View>
          <View style={[styles.tabs, { borderColor: palette.line, backgroundColor: palette.bg }]}>
            {(['map', 'plan', 'search', 'settings'] as const).map((id) => (
              <Pressable key={id} onPress={() => setInner(id)} style={[styles.tab, inner === id && styles.tabOn]}>
                <Text style={{ color: inner === id ? '#fff' : palette.fg, fontWeight: '600' }}>{id === 'map' ? 'Harita' : id === 'plan' ? 'Rota' : id === 'search' ? 'Ara' : 'Ayarlar'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </AutoRegion>
    </GeoProvider>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  hidden: { display: 'none' },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingBottom: 8 },
  tab: { flex: 1, padding: 12, alignItems: 'center' },
  tabOn: { backgroundColor: '#ff5b04' },
});
