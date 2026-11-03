import { FlatList, Modal, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { t, type MessageKey } from '../../core/i18n/messages';
import type { ManifestRegion } from '../../core/region/manifest';
import { describeRegion, orderRegions, type RowAction } from '../logic/region-view';
import { useGeo } from './GeoProvider';
import { useRegions } from './hooks';

type Props = { visible: boolean; onClose: () => void; lang?: string; only?: string[]; consentFor?: string[] };

const LABELS: Record<RowAction, MessageKey> = {
  download: 'action.download',
  pause: 'action.pause',
  resume: 'action.resume',
  remove: 'action.remove',
  update: 'action.update',
  retry: 'action.retry',
  cellular: 'action.cellular',
};

export function RegionDownloadSheet({ visible, onClose, lang = 'tr', only, consentFor = [] }: Props) {
  const geo = useGeo();
  const { regions, statusOf, missingBaseBytes } = useRegions();
  const dark = useColorScheme() === 'dark';
  const palette = dark ? { bg: '#1b1b1d', fg: '#f2f2f2', mute: '#9a9aa0', line: '#333', accent: '#ff7a2f' } : { bg: '#ffffff', fg: '#16161a', mute: '#6b6b73', line: '#e3e3e8', accent: '#ff5b04' };
  const shown = orderRegions(only ? regions.filter((region) => only.includes(region.id)) : regions, statusOf);

  const run = (action: RowAction, region: ManifestRegion): void => {
    const quiet = (promise: Promise<unknown>): void => void promise.catch(() => undefined);
    if (action === 'download' || action === 'update' || action === 'retry') quiet(geo.regions.download(region.id));
    else if (action === 'cellular') quiet(geo.regions.download(region.id, { allowCellular: true }));
    else if (action === 'pause') quiet(geo.regions.pause(region.id));
    else if (action === 'resume') quiet(geo.regions.resume(region.id));
    else quiet(geo.regions.remove(region.id));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.bg }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: palette.fg }]}>{t(lang, 'sheet.title')}</Text>
              <Text style={[styles.subtitle, { color: palette.mute }]}>{t(lang, 'sheet.subtitle')}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
              <Text style={{ color: palette.accent, fontWeight: '600' }}>{t(lang, 'sheet.close')}</Text>
            </Pressable>
          </View>
          {shown.length === 0 ? (
            <View style={styles.empty}>
              <Text style={{ color: palette.mute }}>{t(lang, 'sheet.empty')}</Text>
              <Pressable accessibilityRole="button" onPress={() => void geo.regions.checkUpdates()} style={styles.refresh}>
                <Text style={{ color: palette.accent, fontWeight: '600' }}>{t(lang, 'sheet.refresh')}</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(region) => region.id}
              extraData={statusOf}
              renderItem={({ item }) => {
                const row = describeRegion({ region: item, status: statusOf(item.id), baseBytes: missingBaseBytes, lang, consentPending: consentFor.includes(item.id) });
                const direction = row.rtl ? 'row-reverse' : 'row';
                const align = row.rtl ? 'right' : 'left';
                return (
                  <View style={[styles.row, { borderColor: palette.line }]}>
                    <View style={{ flexDirection: direction, justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={[styles.name, { color: palette.fg, textAlign: align, writingDirection: row.rtl ? 'rtl' : 'ltr' }]}>{row.name}</Text>
                      <Text style={{ color: palette.mute, fontSize: 12 }}>{row.sizeText}</Text>
                    </View>
                    <Text style={{ color: row.errorText ? '#d33' : palette.mute, textAlign: align, fontSize: 12, marginTop: 2 }}>{row.errorText ?? row.statusText}</Text>
                    {row.updatedText ? <Text style={{ color: palette.mute, textAlign: align, fontSize: 12 }}>{row.updatedText}</Text> : null}
                    {row.progressPercent !== null ? (
                      <View style={[styles.bar, { backgroundColor: palette.line }]}>
                        <View style={{ width: `${row.progressPercent}%`, height: 4, borderRadius: 2, backgroundColor: palette.accent, alignSelf: row.rtl ? 'flex-end' : 'flex-start' }} />
                      </View>
                    ) : null}
                    {row.actions.length > 0 ? (
                      <View style={{ flexDirection: direction, gap: 16, marginTop: 8 }}>
                        {row.actions.map((action) => (
                          <Pressable key={action} accessibilityRole="button" onPress={() => run(action, item)} hitSlop={8}>
                            <Text style={{ color: action === 'remove' ? '#d33' : palette.accent, fontWeight: '600' }}>{t(lang, LABELS[action])}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  headerText: { flex: 1, paddingRight: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  subtitle: { fontSize: 13, marginTop: 4 },
  row: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  bar: { height: 4, borderRadius: 2, marginTop: 8 },
  empty: { paddingVertical: 32, alignItems: 'center', gap: 12 },
  refresh: { padding: 8 },
});
