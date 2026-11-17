import { Paths } from 'expo-file-system';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { t } from '../../../src/core';
import { RegionDownloadSheet, useGeo, useRegions } from '../../../src/native';
import { Chip, Row, usePalette } from './ui';

const LANGS = ['tr', 'en', 'de', 'ar', 'ru', 'el'];

export function SettingsScreen({ lang, onLang, theme, onTheme, server, onServer, serverNote }: { lang: string; onLang: (lang: string) => void; theme: 'light' | 'dark'; onTheme: (theme: 'light' | 'dark') => void; server: string; onServer: (url: string) => void; serverNote: string }) {
  const geo = useGeo();
  const palette = usePalette();
  const { regions, statusOf } = useRegions();
  const [sheet, setSheet] = useState(false);
  const [typed, setTyped] = useState(server);
  const [info, setInfo] = useState('');
  const installed = regions.filter((r) => statusOf(r.id).installedParts.length > 0);
  const stats = geo.learn.stats();

  return (
    <ScrollView contentContainerStyle={[styles.page, { backgroundColor: palette.bg }]}>
      <Text style={[styles.heading, { color: palette.fg }]}>Ayarlar</Text>
      <Text style={{ color: palette.mute }}>Dil (etiketler, pencere metinleri, harita yazıları)</Text>
      <Row>
        {LANGS.map((code) => (
          <Chip key={code} label={code} active={code === lang} onPress={() => onLang(code)} />
        ))}
      </Row>
      <Text style={{ color: palette.mute }}>Tema</Text>
      <Row>
        <Chip label="Açık" active={theme === 'light'} onPress={() => onTheme('light')} />
        <Chip label="Koyu" active={theme === 'dark'} onPress={() => onTheme('dark')} />
      </Row>
      <Text style={{ color: palette.mute }}>Paket sunucusu</Text>
      <TextInput style={[styles.input, { color: palette.fg, borderColor: palette.line }]} value={typed} onChangeText={setTyped} onEndEditing={() => onServer(typed)} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Text style={{ color: palette.mute, fontSize: 12 }}>{serverNote}</Text>
      <Row>
        <Pressable style={styles.action} onPress={() => setSheet(true)}>
          <Text style={styles.actionText}>{t(lang, 'sheet.title')}</Text>
        </Pressable>
        <Pressable
          style={styles.action}
          onPress={() =>
            void geo.regions.checkUpdates().then((result) => setInfo(result.ok ? `Güncelleme: ${result.updates.length ? result.updates.join(', ') : 'yok'}` : `Denetim başarısız: ${result.code}`))
          }
        >
          <Text style={styles.actionText}>Güncellemeleri denetle</Text>
        </Pressable>
      </Row>
      {info ? <Text style={{ color: palette.fg }}>{info}</Text> : null}
      <Text style={{ color: palette.mute }}>Kurulu iller</Text>
      {installed.length === 0 ? <Text style={{ color: palette.fg }}>Yok</Text> : installed.map((r) => <Text key={r.id} style={{ color: palette.fg }}>{`${r.id} ${r.names[lang] ?? r.names.tr}: ${statusOf(r.id).installedParts.join(', ')}`}</Text>)}
      <Text style={{ color: palette.mute }}>Boş yer</Text>
      <Text style={{ color: palette.fg }}>{`${Math.round(Paths.availableDiskSpace / 1_000_000)} MB`}</Text>
      <Text style={{ color: palette.mute }}>Öğrenilen kapılar</Text>
      <Text style={{ color: palette.fg }}>{`${stats.keys} adres, ${stats.confirmations} onay`}</Text>
      <Pressable style={[styles.action, { alignSelf: 'flex-start' }]} onPress={() => void geo.learn.clear().then(() => setInfo('Öğrenilenler silindi'))}>
        <Text style={styles.actionText}>Öğrenilenleri sil</Text>
      </Pressable>
      <Text style={{ color: palette.mute, fontSize: 11 }}>{t(lang, 'attribution.text')}</Text>
      <View style={{ height: 40 }} />
      <RegionDownloadSheet visible={sheet} onClose={() => setSheet(false)} lang={lang} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: Platform.OS === 'ios' ? 64 : 32, gap: 8 },
  heading: { fontSize: 24, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14 },
  action: { backgroundColor: '#ff5b04', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  actionText: { color: '#fff', fontWeight: '600' },
});
