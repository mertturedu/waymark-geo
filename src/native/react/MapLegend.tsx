import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { t, type MessageKey } from '../../core/i18n/messages';
import { MAP_ICON_IMAGES } from '../platform/icon-images';
import { isRtl } from '../../core/i18n/messages';

const ROWS: { icon: string; label: MessageKey }[] = [
  { icon: 'geo-health', label: 'legend.health' },
  { icon: 'geo-pharmacy', label: 'legend.pharmacy' },
  { icon: 'geo-safety', label: 'legend.safety' },
  { icon: 'geo-money', label: 'legend.money' },
  { icon: 'geo-fuel', label: 'legend.fuel' },
  { icon: 'geo-worship', label: 'legend.worship' },
  { icon: 'geo-lodging', label: 'legend.lodging' },
  { icon: 'geo-market', label: 'legend.market' },
  { icon: 'geo-food', label: 'legend.food' },
  { icon: 'geo-shop', label: 'legend.shop' },
  { icon: 'geo-public', label: 'legend.public' },
  { icon: 'geo-cargo', label: 'legend.cargo' },
  { icon: 'geo-landmark', label: 'legend.landmark' },
  { icon: 'geo-brand-a101', label: 'legend.brands' },
];

const TOKEN: Record<string, string> = {
  'geo-health': 'group:health',
  'geo-pharmacy': 'group:pharmacy',
  'geo-safety': 'group:safety',
  'geo-money': 'group:money',
  'geo-fuel': 'group:fuel',
  'geo-worship': 'group:worship',
  'geo-lodging': 'group:lodging',
  'geo-market': 'group:market',
  'geo-food': 'group:food',
  'geo-shop': 'group:shop',
  'geo-public': 'group:public',
  'geo-cargo': 'group:cargo',
  'geo-landmark': 'landmarks',
  'geo-brand-a101': 'brands',
};

export function MapLegend({ visible, onClose, lang = 'tr', hidden, onToggle }: { visible: boolean; onClose: () => void; lang?: string; hidden?: string[]; onToggle?: (token: string) => void }) {
  const dark = useColorScheme() === 'dark';
  const rtl = isRtl(lang);
  const palette = dark ? { bg: '#1b1b1d', fg: '#f2f2f2', line: '#333', accent: '#ff7a2f' } : { bg: '#ffffff', fg: '#16161a', line: '#e3e3e8', accent: '#ff5b04' };
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.bg }]}>
          <View style={[styles.header, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
            <Text style={[styles.title, { color: palette.fg }]}>{t(lang, 'legend.title')}</Text>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
              <Text style={{ color: palette.accent, fontWeight: '600' }}>{t(lang, 'sheet.close')}</Text>
            </Pressable>
          </View>
          <ScrollView>
            {onToggle ? <Text style={{ color: palette.fg, opacity: 0.6, fontSize: 12, marginBottom: 4, textAlign: rtl ? 'right' : 'left' }}>{t(lang, 'legend.hint')}</Text> : null}
            {ROWS.map((row) => {
              const token = TOKEN[row.icon];
              const off = token !== undefined && (hidden ?? []).includes(token);
              return (
                <Pressable key={row.icon} disabled={!onToggle || token === undefined} onPress={() => token && onToggle?.(token)} style={[styles.row, { borderColor: palette.line, flexDirection: rtl ? 'row-reverse' : 'row', opacity: off ? 0.4 : 1 }]}>
                  <Image source={MAP_ICON_IMAGES[row.icon] as number} style={styles.icon} />
                  <Text style={[styles.label, { color: palette.fg, textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{t(lang, row.label)}</Text>
                  {onToggle ? <Text style={{ color: off ? palette.line : palette.accent, fontWeight: '700' }}>{off ? '○' : '●'}</Text> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  sheet: { maxHeight: '80%', borderRadius: 16, padding: 16 },
  header: { justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '700' },
  row: { alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  icon: { width: 30, height: 30 },
  label: { flex: 1, fontSize: 14 },
});
