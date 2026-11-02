import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DeviceTestScreen } from './device-test/DeviceTestScreen';
import { SdkApp } from './sdk/SdkApp';
import { SdkTestScreen } from './sdk-test/SdkTestScreen';
import { OfflineMapScreen } from './spikes/OfflineMapScreen';

type Tab = 'sdk-test' | 'app' | 'old';

export default function App() {
  const [tab, setTab] = useState<Tab>('sdk-test');
  const [opened, setOpened] = useState<Set<Tab>>(new Set(['sdk-test']));
  const [oldView, setOldView] = useState<'tests' | 'map'>('tests');
  const [oldMapOpened, setOldMapOpened] = useState(false);

  const open = (next: Tab) => {
    setOpened((previous) => new Set(previous).add(next));
    setTab(next);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.body, tab !== 'sdk-test' && styles.hidden]}>
        <SdkTestScreen />
      </View>
      {opened.has('app') ? (
        <View style={[styles.body, tab !== 'app' && styles.hidden]}>
          <SdkApp />
        </View>
      ) : null}
      {opened.has('old') ? (
        <View style={[styles.body, tab !== 'old' && styles.hidden]}>
          <View style={styles.oldBar}>
            <Tab label="Faz 0-3 testi" active={oldView === 'tests'} onPress={() => setOldView('tests')} />
            <Tab
              label="Faz 0 haritası"
              active={oldView === 'map'}
              onPress={() => {
                setOldMapOpened(true);
                setOldView('map');
              }}
            />
          </View>
          <View style={[styles.body, oldView !== 'tests' && styles.hidden]}>
            <DeviceTestScreen
              mapOpened={oldMapOpened}
              onOpenMap={() => {
                setOldMapOpened(true);
                setOldView('map');
              }}
            />
          </View>
          {oldMapOpened ? (
            <View style={[styles.body, oldView !== 'map' && styles.hidden]}>
              <OfflineMapScreen />
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.tabs}>
        <Tab label="SDK Testi" active={tab === 'sdk-test'} onPress={() => open('sdk-test')} />
        <Tab label="Uygulama" active={tab === 'app'} onPress={() => open('app')} />
        <Tab label="Eski testler" active={tab === 'old'} onPress={() => open('old')} />
      </View>
      <StatusBar style="auto" />
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  body: { flex: 1 },
  hidden: { display: 'none' },
  oldBar: { flexDirection: 'row', paddingTop: 48, borderBottomWidth: 1, borderColor: '#ddd' },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#ddd', paddingBottom: 24 },
  tab: { flex: 1, padding: 14, alignItems: 'center' },
  tabActive: { backgroundColor: '#ff5b04' },
  tabText: { fontWeight: '600', color: '#333' },
  tabTextActive: { color: '#fff' },
});
