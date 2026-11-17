import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { t, type MessageKey } from '../../core/i18n/messages';
import { LEGEND_GLYPH } from '../map/poi-glyphs';
import { iconColor, type IconGroup } from '../map/theme';
import { LEGEND_IMAGES } from '../platform/legend-images';
import { isRtl } from '../../core/i18n/messages';
import { useGeoTheme } from './GeoProvider';

type Row = { group: IconGroup | 'brands'; label: MessageKey };

const ROWS: Row[] = [
  { group: 'health', label: 'legend.health' },
  { group: 'pharmacy', label: 'legend.pharmacy' },
  { group: 'safety', label: 'legend.safety' },
  { group: 'money', label: 'legend.money' },
  { group: 'fuel', label: 'legend.fuel' },
  { group: 'worship', label: 'legend.worship' },
  { group: 'lodging', label: 'legend.lodging' },
  { group: 'education', label: 'legend.education' },
  { group: 'market', label: 'legend.market' },
  { group: 'food', label: 'legend.food' },
  { group: 'shop', label: 'legend.shop' },
  { group: 'culture', label: 'legend.culture' },
  { group: 'nature', label: 'legend.nature' },
  { group: 'transit', label: 'legend.transit' },
  { group: 'public', label: 'legend.public' },
  { group: 'cargo', label: 'legend.cargo' },
  { group: 'landmark', label: 'legend.landmark' },
  { group: 'brands', label: 'legend.brands' },
];

const tokenOf = (group: Row['group']): string => (group === 'brands' ? 'brands' : group === 'landmark' ? 'landmarks' : `group:${group}`);

function Badge({ color, glyph }: { color: string; glyph: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color }]}>
      <Image source={LEGEND_IMAGES[`legend-${glyph}`] as number} style={styles.glyph} tintColor="#FFFFFF" />
    </View>
  );
}

export function MapLegend({ visible, onClose, lang = 'tr', hidden, onToggle }: { visible: boolean; onClose: () => void; lang?: string; hidden?: string[]; onToggle?: (token: string) => void }) {
  const dark = useColorScheme() === 'dark';
  const rtl = isRtl(lang);
  const theme = useGeoTheme();
  const side = dark ? theme.dark : theme.light;
  const colorOf = (group: Row['group']): string => iconColor(side.map, group === 'brands' ? 'market' : group, dark ? 'dark' : 'light', side.colors.accent);
  const palette = dark ? { bg: '#171a22', fg: '#eef1f7', line: '#2c3240', accent: '#ff7a2f' } : { bg: '#ffffff', fg: '#14171f', line: '#dde1ea', accent: '#ff5b04' };
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
              const token = tokenOf(row.group);
              const off = (hidden ?? []).includes(token);
              return (
                <Pressable key={row.group} disabled={!onToggle} onPress={() => onToggle?.(token)} style={[styles.row, { borderColor: palette.line, flexDirection: rtl ? 'row-reverse' : 'row', opacity: off ? 0.4 : 1 }]}>
                  <Badge color={colorOf(row.group)} glyph={LEGEND_GLYPH[row.group]} />
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
  badge: { width: 30, height: 30, borderRadius: 9, borderWidth: 1.5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  glyph: { width: 18, height: 18 },
  label: { flex: 1, fontSize: 14 },
});
