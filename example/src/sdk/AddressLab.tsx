import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseAddress, type Lang, type Place, type ResolveResult } from '../../../src/core';
import { useGeo } from '../../../src/native';
import { forUpload, loadField, saveField, unsent, type FieldRecord } from './fieldStore';
import { lastTap } from './lastTap';
import type { Showing } from './SearchScreen';
import { usePalette } from './ui';

type Solved = { status: string; ms: number; places: Place[]; parsed: [string, string][] };

const parsedRows = (text: string): [string, string][] => {
  const p = parseAddress(text);
  const rows: [string, string | null][] = [
    ['il', p.province?.name ?? null],
    ['ilçe', p.district?.name ?? null],
    ['mahalle', p.neighbourhood],
    ['sokak', p.street ? `${p.street.text}${p.street.kind ? ` (${p.street.kind})` : ''}` : null],
    ['ikinci sokak', p.secondStreet?.text ?? null],
    ['kapı no', p.houseNumber],
    ['bina', p.building],
    ['blok', p.block],
    ['kat', p.floor],
    ['daire', p.door],
    ['yer', p.poiName],
    ['posta kodu', p.postcode],
    ['artık', p.leftover.length > 0 ? p.leftover.join(' ') : null],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null && r[1] !== '');
};

function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, disabled && styles.off]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function AddressLab({ lang, server, onShow }: { lang: string; server: string; onShow: (showing: Showing) => void }) {
  const geo = useGeo();
  const palette = usePalette();
  const [text, setText] = useState('');
  const [solved, setSolved] = useState<Solved | null>(null);
  const [floor, setFloor] = useState('');
  const [door, setDoor] = useState('');
  const [records, setRecords] = useState<FieldRecord[]>([]);
  const [busy, setBusy] = useState('');

  useEffect(() => setRecords(loadField()), []);

  const keep = (next: FieldRecord[]) => {
    setRecords(next);
    saveField(next);
  };

  const solve = async () => {
    if (text.trim().length < 3) return;
    const started = performance.now();
    const result: ResolveResult = await geo.search.resolve(text, { language: lang as Lang });
    const ms = performance.now() - started;
    const places = result.status === 'resolved' ? [result.best, ...result.candidates.filter((c) => c.id !== result.best.id)] : result.status === 'region_missing' ? [] : result.candidates;
    setSolved({ status: result.status === 'region_missing' ? `il paketi yok: ${result.regions.join(', ')}` : result.status, ms, places: places.slice(0, 6), parsed: parsedRows(text) });
  };

  const record = (point: [number, number], source: 'gps' | 'map', accuracyM: number | null) => {
    const item: FieldRecord = {
      id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
      at: Date.now(),
      text: text.trim(),
      point,
      source,
      accuracyM,
      ...(floor.trim() ? { floor: floor.trim() } : {}),
      ...(door.trim() ? { door: door.trim() } : {}),
      device: `${Device.modelId ?? Device.modelName ?? 'cihaz'}`,
    };
    keep([...records, item]);
    setFloor('');
    setDoor('');
    Alert.alert('Kaydedildi', `${records.length + 1}. kayıt${accuracyM !== null ? `, konum doğruluğu ${Math.round(accuracyM)} m` : ''}`);
  };

  const withGps = async () => {
    if (text.trim().length < 3) return Alert.alert('Önce adresi yaz');
    setBusy('Konum alınıyor');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') return Alert.alert('Konum izni yok');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const accuracy = position.coords.accuracy ?? null;
      if (accuracy !== null && accuracy > 30) Alert.alert('Konum zayıf', `Doğruluk ${Math.round(accuracy)} m. Kapıya yakın, açık havada tekrar dene ya da haritadan seç.`);
      else record([position.coords.longitude, position.coords.latitude], 'gps', accuracy);
    } catch {
      Alert.alert('Konum alınamadı');
    } finally {
      setBusy('');
    }
  };

  const withTap = () => {
    if (text.trim().length < 3) return Alert.alert('Önce adresi yaz');
    const tap = lastTap();
    if (!tap) return Alert.alert('Haritada nokta yok', 'Harita sekmesinde kapının olduğu yere dokun, sonra buraya dön.');
    record(tap.point, 'map', null);
  };

  const send = async () => {
    const pending = unsent(records);
    if (pending.length === 0) return Alert.alert('Gönderilecek kayıt yok');
    setBusy('Gönderiliyor');
    try {
      const response = await fetch(`${server}/saha`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forUpload(pending)) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      const ids = new Set(pending.map((r) => r.id));
      keep(records.map((r) => (ids.has(r.id) ? { ...r, sent: true } : r)));
      Alert.alert('Gönderildi', `${pending.length} kayıt`);
    } catch (error) {
      Alert.alert('Gönderilemedi', `${error instanceof Error ? error.message : String(error)}. "Kopyala" ile paylaşabilirsin.`);
    } finally {
      setBusy('');
    }
  };

  const copy = async () => {
    await Clipboard.setStringAsync(JSON.stringify(forUpload(records)));
    Alert.alert('Kopyalandı', `${records.length} kayıt panoda`);
  };

  const tap = lastTap();
  const tapAge = tap ? Math.round((Date.now() - tap.at) / 1000) : null;
  const sentCount = records.filter((r) => r.sent).length;

  return (
    <ScrollView style={{ backgroundColor: palette.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: palette.fg }]}>Adres Lab</Text>
      <TextInput value={text} onChangeText={setText} placeholder="Açık adres yaz" placeholderTextColor={palette.mute} multiline style={[styles.input, { color: palette.fg, borderColor: palette.line, backgroundColor: palette.card }]} />
      <View style={styles.row}>
        <Button label="Çöz" onPress={() => void solve()} />
        <Button label="Temizle" onPress={() => { setText(''); setSolved(null); }} />
      </View>

      {solved ? (
        <View style={[styles.card, { backgroundColor: palette.card }]}>
          <Text style={{ color: palette.fg, fontWeight: '700' }}>{`${solved.status} · ${Math.round(solved.ms)} ms`}</Text>
          {solved.parsed.map(([k, v]) => (
            <Text key={k} style={{ color: palette.mute }}>{`${k}: ${v}`}</Text>
          ))}
          {solved.places.map((place, i) => (
            <Pressable key={`${place.id}-${i}`} onPress={() => onShow({ label: place.label, point: place.coordinate })} style={[styles.place, { borderColor: palette.line }]}>
              <Text style={{ color: palette.fg }}>{place.label}</Text>
              <Text style={{ color: palette.mute, fontSize: 12 }}>{`${place.precision}${place.approximate ? ' · yaklaşık' : ''} · ${place.source} · güven ${place.confidence.toFixed(2)}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={[styles.title, { color: palette.fg, marginTop: 18 }]}>Saha kaydı</Text>
      <Text style={{ color: palette.mute }}>Adresin gerçek kapısını kaydet: kapıdayken konumla ya da Harita sekmesinde kapıya dokunup "haritadaki noktayla".</Text>
      <View style={styles.row}>
        <TextInput value={floor} onChangeText={setFloor} placeholder="Kat (isteğe bağlı)" placeholderTextColor={palette.mute} style={[styles.small, { color: palette.fg, borderColor: palette.line }]} />
        <TextInput value={door} onChangeText={setDoor} placeholder="Daire (isteğe bağlı)" placeholderTextColor={palette.mute} style={[styles.small, { color: palette.fg, borderColor: palette.line }]} />
      </View>
      <View style={styles.row}>
        <Button label="Konumumla kaydet" onPress={() => void withGps()} disabled={busy !== ''} />
        <Button label={tapAge !== null ? `Haritadaki noktayla (${tapAge} sn önce)` : 'Haritadaki noktayla'} onPress={withTap} disabled={busy !== ''} />
      </View>
      {busy ? <Text style={{ color: palette.accent }}>{busy}</Text> : null}
      <Text style={{ color: palette.fg, marginTop: 8 }}>{`${records.length} kayıt (${sentCount} gönderildi)`}</Text>
      {records.slice(-5).reverse().map((r) => (
        <Text key={r.id} style={{ color: palette.mute, fontSize: 12 }} numberOfLines={1}>{`${r.sent ? '✓' : '·'} ${r.text}${r.floor ? ` · kat ${r.floor}` : ''}${r.door ? ` · daire ${r.door}` : ''} · ${r.source}`}</Text>
      ))}
      <View style={styles.row}>
        <Button label="Sunucuya gönder" onPress={() => void send()} disabled={busy !== ''} />
        <Button label="Kopyala" onPress={() => void copy()} />
        <Button label="Gönderilenleri sil" onPress={() => keep(unsent(records))} disabled={sentCount === 0} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 120, gap: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 10, padding: 10, minHeight: 70, fontSize: 15 },
  small: { borderWidth: 1, borderRadius: 8, padding: 8, flex: 1, fontSize: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { backgroundColor: '#ff5b04', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  off: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600' },
  card: { borderRadius: 10, padding: 10, gap: 4 },
  place: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, marginTop: 4 },
});
