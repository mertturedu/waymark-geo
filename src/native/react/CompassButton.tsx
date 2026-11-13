import { Pressable, StyleSheet, View, useColorScheme, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '../../core/i18n/messages';
import { compassRotation, compassVisible } from '../logic/compass';

type Props = { bearing: number; onPress: () => void; lang?: string; size?: number; style?: StyleProp<ViewStyle> };

export function CompassButton({ bearing, onPress, lang = 'tr', size = 44, style }: Props) {
  const dark = useColorScheme() === 'dark';
  if (!compassVisible(bearing)) return null;
  const needle = Math.round(size * 0.3);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(lang, 'compass.north')}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.button, { width: size, height: size, borderRadius: Math.round(size * 0.3), borderWidth: 1, borderColor: dark ? '#2C3240' : '#DDE1EA', backgroundColor: dark ? '#232834' : '#FFFFFF', opacity: pressed ? 0.7 : 1 }, style]}
    >
      <View style={{ transform: [{ rotate: `${compassRotation(bearing)}deg` }], alignItems: 'center' }}>
        <View style={{ width: 0, height: 0, borderLeftWidth: needle / 2, borderRightWidth: needle / 2, borderBottomWidth: needle, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: dark ? '#FF7A2F' : '#FF5B04' }} />
        <View style={{ width: 0, height: 0, borderLeftWidth: needle / 2, borderRightWidth: needle / 2, borderTopWidth: needle, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: dark ? '#7A8196' : '#9499AB' }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } } });
