import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { isRtl } from '../../core/i18n/messages';

type Props = { text: string | null; lang?: string };

export function HereStrip({ text, lang = 'tr' }: Props) {
  const dark = useColorScheme() === 'dark';
  if (!text) return null;
  const rtl = isRtl(lang);
  return (
    <View accessibilityRole="text" style={[styles.strip, { backgroundColor: dark ? 'rgba(28,28,30,0.92)' : 'rgba(255,255,255,0.94)' }]}>
      <Text numberOfLines={1} style={[styles.text, { color: dark ? '#F2F2F2' : '#16161A', textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ strip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 }, text: { fontSize: 14, fontWeight: '600' } });
