import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { isRtl, t, type MessageKey } from '../../core/i18n/messages';
import type { PlanResult } from '../../core/plan/types';
import { rowsOf, type PlanState } from '../logic/plan-view';
import type { PlanControls } from './usePlan';

const REASON: Record<string, MessageKey> = { no_road: 'plan.noRoad', outside_region: 'plan.outside', disconnected: 'plan.disconnected' };

export function planSummary(lang: string, result: PlanResult | null): string {
  if (!result) return t(lang, 'plan.empty');
  if (!result.ok) return result.code === 'CONSTRAINT_CONFLICT' ? t(lang, 'plan.conflict') : result.code === 'TOO_MANY_STOPS' ? t(lang, 'plan.tooMany', { max: 100 }) : result.code;
  return t(lang, 'plan.total', { km: (result.totalDistanceM / 1000).toFixed(1), min: Math.round(result.totalDurationS / 60) });
}

export function PlanStopList({ controls, lang = 'tr', dark = false, onCurrentPosition }: { controls: PlanControls; lang?: string; dark?: boolean; onCurrentPosition?: () => Promise<[number, number] | null> }) {
  const { state, result, busy } = controls;
  const rows = rowsOf(state, result);
  const palette = dark ? { fg: '#f2f2f2', sub: '#a0a0ab', line: '#333', chip: '#2a2a30', accent: '#6aa0ff' } : { fg: '#16161a', sub: '#666672', line: '#e3e3e8', chip: '#f1f2f6', accent: '#2b6cff' };
  const dir = isRtl(lang) ? 'row-reverse' : 'row';
  const endLabel = state.end === 'free' ? t(lang, 'plan.free') : state.end === 'return' ? t(lang, 'plan.return') : t(lang, 'plan.end');
  const nextEnd = (): PlanState['end'] => (state.end === 'free' ? 'return' : 'free');
  const remaining = async (): Promise<void> => {
    const here = onCurrentPosition ? await onCurrentPosition() : null;
    if (here) await controls.sortRemaining(here);
  };
  return (
    <View>
      <View style={[styles.bar, { flexDirection: dir }]}>
        <Pressable accessibilityRole="button" disabled={busy || state.stops.length === 0} onPress={() => void controls.sort()} style={[styles.primary, { backgroundColor: palette.accent }]}>
          <Text style={styles.primaryText}>{t(lang, 'plan.sort')}</Text>
        </Pressable>
        {onCurrentPosition ? (
          <Pressable accessibilityRole="button" disabled={busy || state.stops.length === 0} onPress={() => void remaining()} style={[styles.chip, { backgroundColor: palette.chip }]}>
            <Text style={[styles.chipText, { color: palette.fg }]}>{t(lang, 'plan.sortRest')}</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => controls.setEnd(nextEnd())} style={[styles.chip, { backgroundColor: palette.chip }]}>
          <Text style={[styles.chipText, { color: palette.fg }]}>{`${t(lang, 'plan.end')}: ${endLabel}`}</Text>
        </Pressable>
      </View>
      <Text style={[styles.summary, { color: palette.sub, textAlign: isRtl(lang) ? 'right' : 'left' }]}>{planSummary(lang, result)}</Text>
      <ScrollView style={styles.list}>
        {rows.map((row, index) => (
          <View key={row.id} style={[styles.row, { flexDirection: dir, borderColor: palette.line, opacity: row.visited ? 0.5 : 1 }]}>
            <View style={[styles.badge, { borderColor: row.pinned ? palette.fg : palette.accent }]}>
              <Text style={[styles.badgeText, { color: palette.fg }]}>{row.number ?? index + 1}</Text>
            </View>
            <View style={styles.grow}>
              <Text numberOfLines={1} style={[styles.label, { color: palette.fg, textAlign: isRtl(lang) ? 'right' : 'left' }]}>{row.label}</Text>
              {row.unreachable ? <Text style={styles.warn}>{t(lang, REASON[row.unreachable] ?? 'plan.noRoad')}</Text> : null}
              {row.isStart ? <Text style={[styles.sub, { color: palette.sub }]}>{t(lang, 'plan.start')}</Text> : null}
            </View>
            <Small label="↑" onPress={() => controls.moveStop(index, index - 1)} color={palette.fg} />
            <Small label="↓" onPress={() => controls.moveStop(index, index + 1)} color={palette.fg} />
            <Small label={row.pinned ? '◉' : '○'} onPress={() => controls.togglePin(row.id)} color={palette.accent} />
            <Small label="✓" onPress={() => controls.visit(row.id)} color={palette.sub} />
            <Small label="✕" onPress={() => controls.removeStop(row.id)} color={palette.sub} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Small({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={6} style={styles.small}>
      <Text style={[styles.smallText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  primary: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 8 },
  primaryText: { color: '#fff', fontWeight: '600' },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13 },
  summary: { marginTop: 6, fontSize: 13 },
  list: { maxHeight: 280, marginTop: 4 },
  row: { alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  badge: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  grow: { flex: 1 },
  label: { fontSize: 14 },
  sub: { fontSize: 11 },
  warn: { fontSize: 11, color: '#d33' },
  small: { paddingHorizontal: 6, paddingVertical: 2 },
  smallText: { fontSize: 18 },
});
