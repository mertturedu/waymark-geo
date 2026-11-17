import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

export function usePalette() {
  const dark = useColorScheme() === 'dark';
  return dark ? { bg: '#121214', card: '#1d1d20', fg: '#f2f2f2', mute: '#9a9aa0', line: '#333', accent: '#ff7a2f', bad: '#ff6b6b', good: '#4cc38a' } : { bg: '#ffffff', card: '#f4f4f6', fg: '#16161a', mute: '#6b6b73', line: '#e3e3e8', accent: '#ff5b04', bad: '#c62828', good: '#1b8a3a' };
}

export function Chip({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      <Text style={styles.chipText}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

export const styles = StyleSheet.create({
  chip: { backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6 },
  chipOn: { backgroundColor: '#ff5b04' },
  chipText: { color: '#fff', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
