import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { isRtl, t } from '../../core/i18n/messages';
import type { PlaceCardData } from '../logic/place-card';
import { useGeoTheme } from './GeoProvider';

type Props = { card: PlaceCardData | null; onRoute: (card: PlaceCardData) => void; onCopy?: (text: string) => void; onClose: () => void; lang?: string };

export function PlaceCard({ card, onRoute, onCopy, onClose, lang = 'tr' }: Props) {
  const dark = useColorScheme() === 'dark';
  const theme = useGeoTheme();
  if (!card) return null;
  const side = dark ? theme.dark : theme.light;
  const rtl = isRtl(lang);
  const palette = dark ? { bg: '#1b1b1d', fg: '#f2f2f2', mute: '#9a9aa0', line: '#333' } : { bg: '#ffffff', fg: '#16161a', mute: '#6b6b73', line: '#e3e3e8' };
  const align = { textAlign: rtl ? ('right' as const) : ('left' as const), writingDirection: rtl ? ('rtl' as const) : ('ltr' as const) };
  return (
    <View style={[styles.card, { backgroundColor: palette.bg, borderRadius: side.colors.radius }]}>
      <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={styles.texts}>
          <Text accessibilityRole="header" style={[styles.title, align, { color: palette.fg }]}>{card.title}</Text>
          {card.category ? <Text style={[styles.category, align, { color: palette.mute }]}>{card.category}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t(lang, 'card.close')} onPress={onClose} hitSlop={12}>
          <Text style={{ color: palette.mute, fontSize: 18 }}>×</Text>
        </Pressable>
      </View>
      {card.lines.length > 0 ? card.lines.map((line) => <Text key={line} style={[styles.line, align, { color: palette.fg }]}>{line}</Text>) : <Text style={[styles.line, align, { color: palette.mute }]}>{t(lang, 'card.noAddress')}</Text>}
      <View style={[styles.actions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Pressable accessibilityRole="button" onPress={() => onRoute(card)} style={[styles.button, { backgroundColor: side.colors.accent, borderColor: side.colors.accent, borderRadius: side.colors.radius }]}>
          <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t(lang, 'card.route')}</Text>
        </Pressable>
        {card.copyText && onCopy ? (
          <Pressable accessibilityRole="button" onPress={() => onCopy(card.copyText as string)} style={[styles.button, { borderColor: palette.line, borderRadius: side.colors.radius }]}>
            <Text style={[styles.buttonText, { color: palette.fg }]}>{t(lang, 'card.copy')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 6, elevation: 6, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: -2 } },
  texts: { flex: 1, paddingRight: 8 },
  title: { fontSize: 18, fontWeight: '700' },
  category: { fontSize: 13, marginTop: 2 },
  line: { fontSize: 15 },
  actions: { gap: 10, marginTop: 8 },
  button: { flex: 1, borderWidth: 1, paddingVertical: 11, alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
