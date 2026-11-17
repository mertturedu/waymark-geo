import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { isRtl } from '../../core/i18n/messages';

type Props = { text: string | null; lang?: string };

export function HereStrip({ text, lang = 'tr' }: Props) {
  const dark = useColorScheme() === 'dark';
  if (!text) return null;
  const rtl = isRtl(lang);
  return (
    <View accessibilityRole="text" style={[styles.strip, { backgroundColor: dark ? 'rgba(23,26,34,0.94)' : 'rgba(255,255,255,0.96)', borderColor: dark ? '#FF7A2F' : '#FF5B04', flexDirection: rtl ? 'row-reverse' : 'row' }]}>
      <Text numberOfLines={1} style={[styles.text, { color: dark ? '#EEF1F7' : '#14171F', textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({ strip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderLeftWidth: 4 }, text: { fontSize: 14, fontWeight: '600', letterSpacing: 0.2 } });
