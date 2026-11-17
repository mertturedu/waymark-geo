import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../../core/i18n/messages';
import type { AttributionState } from '../logic/attribution';

export const COLLAPSED_LABEL = '© OSM';

export function GeoAttribution({ lang = 'tr', state, onToggle }: { lang?: string; state: AttributionState; onToggle: () => void }) {
  return (
    <View pointerEvents="box-none" style={styles.wrap}>
      <Pressable accessibilityRole="button" onPress={onToggle} style={[styles.box, state === 'expanded' ? null : styles.quiet]}>
        <Text style={[styles.text, state === 'expanded' ? null : styles.small]}>{state === 'expanded' ? t(lang, 'attribution.text') : COLLAPSED_LABEL}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 8, bottom: 8, alignItems: 'flex-start' },
  box: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  quiet: { backgroundColor: 'rgba(255,255,255,0.55)', paddingHorizontal: 5, paddingVertical: 2 },
  text: { fontSize: 11, color: '#222' },
  small: { fontSize: 9, color: '#555' },
});
