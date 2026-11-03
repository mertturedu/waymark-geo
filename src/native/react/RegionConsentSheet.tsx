import { Modal, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { isRtl, t } from '../../core/i18n/messages';
import type { AutoDecision } from '../../core/packs/region';
import { formatBytes } from '../logic/size';
import { useGeoTheme } from './GeoProvider';
import { useRegions } from './hooks';

type Props = { decision: AutoDecision; onAllow: () => void; onWait: () => void; lang?: string };

export function RegionConsentSheet({ decision, onAllow, onWait, lang = 'tr' }: Props) {
  const { regions } = useRegions();
  const dark = useColorScheme() === 'dark';
  const theme = useGeoTheme();
  const rtl = isRtl(lang);
  const side = dark ? theme.dark : theme.light;
  const palette = dark ? { bg: '#1b1b1d', fg: '#f2f2f2', mute: '#9a9aa0', line: '#333' } : { bg: '#ffffff', fg: '#16161a', mute: '#6b6b73', line: '#e3e3e8' };
  const names = decision.regions.map((id) => {
    const region = regions.find((candidate) => candidate.id === id);
    return region?.names[lang] ?? region?.names.tr ?? id;
  });
  const align = { textAlign: rtl ? ('right' as const) : ('left' as const), writingDirection: rtl ? ('rtl' as const) : ('ltr' as const) };
  return (
    <Modal visible={decision.action === 'consent'} animationType="fade" transparent onRequestClose={onWait}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.bg, borderRadius: side.colors.radius }]}>
          <Text accessibilityRole="header" style={[styles.title, align, { color: palette.fg }]}>{t(lang, 'consent.title')}</Text>
          <Text style={[styles.body, align, { color: palette.mute }]}>{t(lang, 'consent.body', { name: names.join(', '), size: formatBytes(decision.bytes ?? 0, lang) })}</Text>
          <View style={[styles.actions, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            <Pressable accessibilityRole="button" onPress={onWait} style={[styles.button, { borderColor: palette.line, borderRadius: side.colors.radius }]}>
              <Text style={[styles.buttonText, { color: palette.fg }]}>{t(lang, 'consent.wait')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onAllow} style={[styles.button, { backgroundColor: side.colors.accent, borderColor: side.colors.accent, borderRadius: side.colors.radius }]}>
              <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>{t(lang, 'consent.allow')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { padding: 20, gap: 10 },
  title: { fontSize: 18, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21 },
  actions: { gap: 10, marginTop: 8 },
  button: { flex: 1, borderWidth: 1, paddingVertical: 12, alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
