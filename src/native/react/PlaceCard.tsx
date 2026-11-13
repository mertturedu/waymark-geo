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
  const palette = dark ? { bg: '#171a22', fg: '#eef1f7', mute: '#9aa1b4', line: '#2c3240', chip: '#232834' } : { bg: '#ffffff', fg: '#14171f', mute: '#667085', line: '#dde1ea', chip: '#f4f5f8' };
  const align = { textAlign: rtl ? ('right' as const) : ('left' as const), writingDirection: rtl ? ('rtl' as const) : ('ltr' as const) };
  return (
    <View style={[styles.card, { backgroundColor: palette.bg, borderTopLeftRadius: side.colors.radius, borderTopRightRadius: side.colors.radius, borderTopColor: side.colors.accent }]}>
      <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={styles.texts}>
          <Text accessibilityRole="header" style={[styles.title, align, { color: palette.fg }]}>{card.title}</Text>
          {card.category ? <Text style={[styles.category, align, { color: side.colors.accent, backgroundColor: palette.chip }]}>{card.category}</Text> : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t(lang, 'card.close')} onPress={onClose} hitSlop={12}>
          <Text style={{ color: palette.mute, fontSize: 18 }}>×</Text>
        </Pressable>
      </View>
      {card.lines.length > 0 ? card.lines.map((line) => <Text key={line} style={[styles.line, align, { color: palette.fg }]}>{line}</Text>) : <Text style={[styles.line, align, { color: palette.mute }]}>{t(lang, 'card.noAddress')}</Text>}
      <View style={[styles.actions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        <Pressable accessibilityRole="button" onPress={() => onRoute(card)} style={[styles.button, { backgroundColor: side.colors.accent, borderColor: side.colors.accent, borderRadius: Math.round(side.colors.radius * 0.6) }]}>
          <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t(lang, 'card.route')}</Text>
        </Pressable>
        {card.copyText && onCopy ? (
          <Pressable accessibilityRole="button" onPress={() => onCopy(card.copyText as string)} style={[styles.button, { borderColor: palette.line, borderRadius: Math.round(side.colors.radius * 0.6) }]}>
            <Text style={[styles.buttonText, { color: palette.fg }]}>{t(lang, 'card.copy')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 6, borderTopWidth: 3, elevation: 6, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: -3 } },
  texts: { flex: 1, paddingRight: 8 },
  title: { fontSize: 19, fontWeight: '800', letterSpacing: -0.2 },
  category: { alignSelf: 'flex-start', fontSize: 12, fontWeight: '600', marginTop: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  line: { fontSize: 15 },
  actions: { gap: 10, marginTop: 8 },
  button: { flex: 1, borderWidth: 1, paddingVertical: 11, alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
