import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseAddress, streetLabel, type Lang, type Place, type ResolveResult } from '../../../src/core';
import type { Pending } from './MapScreen';
import { useGeo } from '../../../src/native';
import { savedPoints } from './saved';
import { Row, usePalette } from './ui';

function pendingOf(place: Place, query: string): Pending {
  const parsed = parseAddress(query);
  return { place, ...(!place.components.street && parsed.street ? { street: streetLabel(parsed.street) } : {}), ...(parsed.houseNumber ? { houseNumber: parsed.houseNumber } : {}) };
}

type Shown = { places: Place[]; ms: number; status: string; suggestion?: Place };

export type Showing = { label: string; point: [number, number] };

export function SearchScreen({ lang, onPick, onShow, visible }: { lang: string; onPick: (pending: Pending) => void; onShow: (showing: Showing) => void; visible: boolean }) {
  const geo = useGeo();
  const palette = usePalette();
  const [text, setText] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turn = useRef(0);
  const [listOpen, setListOpen] = useState(false);
  const saved = useMemo(() => (visible ? savedPoints(geo.learn.export()) : []), [geo, visible, shown]);

  const run = async (kind: 'autocomplete' | 'resolve', query: string) => {
    const mine = ++turn.current;
    const started = performance.now();
    if (kind === 'autocomplete') {
      const places = await geo.search.autocomplete(query, { language: lang as Lang });
      if (mine === turn.current) setShown({ places, ms: performance.now() - started, status: 'öneriler' });
      return;
    }
    const result: ResolveResult = await geo.search.resolve(query, { language: lang as Lang });
    if (mine !== turn.current) return;
    const places = result.status === 'resolved' ? [result.best, ...result.candidates.filter((c) => c.id !== result.best.id)] : result.status === 'region_missing' ? [] : result.candidates;
    const extra = result.status === 'region_missing' ? `, indirilecek il: ${result.regions.join(', ')}` : '';
    const suggestion = 'suggestion' in result ? result.suggestion : undefined;
    setShown({ places, ms: performance.now() - started, status: `${result.status}${extra}`, ...(suggestion ? { suggestion } : {}) });
  };

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setShown(null);
      return undefined;
    }
    timer.current = setTimeout(() => void run('autocomplete', text), 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, lang]);

  return (
    <View style={[styles.page, { backgroundColor: palette.bg }]}>
      <TextInput
        style={[styles.input, { color: palette.fg, borderColor: palette.line }]}
        value={text}
        onChangeText={setText}
        placeholder="Adres ya da yer adı"
        placeholderTextColor={palette.mute}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={() => void run('resolve', text)}
      />
      <Row>
        <Pressable style={styles.action} onPress={() => void run('resolve', text)}>
          <Text style={styles.actionText}>Ara</Text>
        </Pressable>
        {shown ? <Text style={{ color: palette.mute, alignSelf: 'center' }}>{`${shown.status}, ${shown.places.length} sonuç, ${shown.ms.toFixed(0)} ms`}</Text> : null}
      </Row>
      {shown?.suggestion ? (
        <Pressable
          onPress={() => {
            setText(shown.suggestion?.label ?? '');
            void run('resolve', shown.suggestion?.label ?? '');
          }}
        >
          <Text style={{ color: palette.fg }}>
            {'Bunu mu demek istediniz: '}
            <Text style={{ color: palette.accent, fontWeight: '600' }}>{shown.suggestion.label}</Text>
          </Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => setListOpen((open) => !open)}>
        <Text style={{ color: palette.accent, fontWeight: '600' }}>{`Kayıtlı noktalarım (${saved.length}) ${listOpen ? '▲' : '▼'}`}</Text>
      </Pressable>
      {listOpen
        ? saved.map((item) => (
            <Pressable key={item.key} onPress={() => onShow({ label: item.text, point: item.point })} style={[styles.item, { borderColor: palette.line }]}>
              <Text style={{ color: palette.fg, fontWeight: '600' }}>{item.text}</Text>
              <Text style={{ color: palette.mute, fontSize: 12 }}>{`${item.count} onay, ${item.point[1].toFixed(5)}, ${item.point[0].toFixed(5)}. Haritada göster`}</Text>
            </Pressable>
          ))
        : null}
      <FlatList
        data={shown?.places ?? []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={[styles.item, { borderColor: palette.line }]}>
            <Text style={{ color: palette.fg, fontWeight: '600' }}>{item.label}</Text>
            <Text style={{ color: palette.mute, fontSize: 12 }}>{`${item.precision}, ${item.approximate ? 'yaklaşık' : 'kesin'}, ${item.source}, güven ${item.confidence.toFixed(2)}${item.details?.category ? `, ${item.details.category}` : ''}`}</Text>
            <Pressable onPress={() => onShow({ label: item.label, point: item.coordinate })} hitSlop={8}>
              <Text style={{ color: palette.accent, fontWeight: '600', marginTop: 4 }}>Haritada göster</Text>
            </Pressable>
            <Pressable onPress={() => onPick(pendingOf(item, text))} hitSlop={8}>
              <Text style={{ color: palette.accent, fontWeight: '600', marginTop: 4 }}>Haritada doğru noktayı seç</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 12, paddingTop: Platform.OS === 'ios' ? 64 : 32, gap: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 16 },
  action: { backgroundColor: '#ff5b04', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  actionText: { color: '#fff', fontWeight: '600' },
  item: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
});
