import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { isRtl } from '../../core/i18n/messages';
import { scaleBar, scaleLabel } from '../logic/scale';

type Props = { zoom: number; latitude: number; lang?: string; maxWidth?: number };

export function ScaleBar({ zoom, latitude, lang = 'tr', maxWidth = 110 }: Props) {
  const dark = useColorScheme() === 'dark';
  const bar = scaleBar(zoom, latitude, maxWidth);
  if (!bar) return null;
  const ink = dark ? '#F2F2F2' : '#16161A';
  return (
    <View accessibilityRole="text" accessibilityLabel={scaleLabel(bar.meters, lang)} style={[styles.wrap, { direction: 'ltr', alignItems: isRtl(lang) ? 'flex-end' : 'flex-start' }]}>
      <Text style={[styles.text, { color: ink, textShadowColor: dark ? '#000' : '#FFF' }]}>{scaleLabel(bar.meters, lang)}</Text>
      <View style={[styles.line, { width: bar.widthPx, borderColor: ink }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 2 },
  text: { fontSize: 11, fontWeight: '600', textShadowRadius: 2 },
  line: { height: 6, borderLeftWidth: 2, borderRightWidth: 2, borderBottomWidth: 2 },
});
