import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { isRtl } from '../../core/i18n/messages';
import { scaleBar, scaleLabel } from '../logic/scale';

type Props = { zoom: number; latitude: number; lang?: string; maxWidth?: number };

export function ScaleBar({ zoom, latitude, lang = 'tr', maxWidth = 110 }: Props) {
  const dark = useColorScheme() === 'dark';
  const bar = scaleBar(zoom, latitude, maxWidth);
  if (!bar) return null;
  const ink = dark ? '#EEF1F7' : '#14171F';
  const half = Math.round(bar.widthPx / 2);
  return (
    <View accessibilityRole="text" accessibilityLabel={scaleLabel(bar.meters, lang)} style={[styles.wrap, { direction: 'ltr', alignItems: isRtl(lang) ? 'flex-end' : 'flex-start' }]}>
      <View style={[styles.track, { width: bar.widthPx, backgroundColor: dark ? 'rgba(23,26,34,0.82)' : 'rgba(255,255,255,0.88)' }]}>
        <View style={{ width: half, height: 4, backgroundColor: ink }} />
        <View style={{ width: bar.widthPx - half, height: 4, backgroundColor: dark ? '#7A8196' : '#9499AB' }} />
      </View>
      <Text style={[styles.text, { color: ink, textShadowColor: dark ? '#000' : '#FFF' }]}>{scaleLabel(bar.meters, lang)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 3 },
  track: { flexDirection: 'row', borderRadius: 3, overflow: 'hidden', padding: 1 },
  text: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, textShadowRadius: 2 },
});
