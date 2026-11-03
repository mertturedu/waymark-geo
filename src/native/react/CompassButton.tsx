import { Pressable, StyleSheet, Text, View, useColorScheme, type StyleProp, type ViewStyle } from 'react-native';
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
      style={({ pressed }) => [styles.button, { width: size, height: size, borderRadius: size / 2, backgroundColor: dark ? '#2C2C2E' : '#FFFFFF', opacity: pressed ? 0.7 : 1 }, style]}
    >
      <View style={{ transform: [{ rotate: `${compassRotation(bearing)}deg` }], alignItems: 'center' }}>
        <View style={{ width: 0, height: 0, borderLeftWidth: needle / 2, borderRightWidth: needle / 2, borderBottomWidth: needle, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#E5322D' }} />
        <View style={{ width: 0, height: 0, borderLeftWidth: needle / 2, borderRightWidth: needle / 2, borderTopWidth: needle, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: dark ? '#8E8E93' : '#A0A0A8' }} />
        <Text style={{ position: 'absolute', top: -needle - 4, fontSize: 9, fontWeight: '700', color: dark ? '#F2F2F2' : '#16161A' }}>N</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } } });
