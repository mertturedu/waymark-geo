import { ActivityIndicator, Image, Pressable, StyleSheet, View, useColorScheme, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '../../core/i18n/messages';
import type { LocateMode, LocatePermission } from '../logic/locate';
import { LOCATE_IMAGES } from '../platform/locate-images';

const BLUE = { light: '#007AFF', dark: '#0A84FF' };
const SURFACE = { light: '#FFFFFF', dark: '#2C2C2E' };

type Props = { mode: LocateMode; permission?: LocatePermission; busy?: boolean; onPress: () => void; lang?: string; size?: number; color?: string; style?: StyleProp<ViewStyle> };

export function LocateButton({ mode, permission = 'unknown', busy = false, onPress, lang = 'tr', size = 44, color, style }: Props) {
  const side = useColorScheme() === 'dark' ? 'dark' : 'light';
  const tint = color ?? BLUE[side];
  const image = mode === 'off' ? LOCATE_IMAGES.arrow : mode === 'follow' ? LOCATE_IMAGES.arrowFill : LOCATE_IMAGES.northFill;
  const label = permission === 'denied' ? t(lang, 'locate.denied') : mode === 'off' ? t(lang, 'locate.off') : mode === 'follow' ? t(lang, 'locate.follow') : t(lang, 'locate.heading');
  const glyph = Math.round(size * 0.46);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: mode !== 'off', busy }}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.button, { width: size, height: size, borderRadius: size / 2, backgroundColor: SURFACE[side], opacity: pressed ? 0.7 : 1 }, style]}
    >
      <View style={{ opacity: permission === 'denied' ? 0.35 : 1 }}>
        {busy ? <ActivityIndicator size="small" color={tint} /> : <Image source={image} style={{ width: glyph, height: glyph }} tintColor={tint} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
});
