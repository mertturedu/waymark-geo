import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Outcome, ReportEntry } from '../../../src/core';
import type { StepStatus } from '../device-test/guide';

export const INK = '#1c1c1e';
export const MUTED = '#8e8e93';
export const ACCENT = '#ff5b04';
const GOOD = '#2e9d57';
const BAD = '#d93a2f';
const LINE = '#ececef';

const TONE: Record<StepStatus, string> = { locked: '#c7c7cc', todo: ACCENT, done: GOOD, fail: BAD };
const DOT: Record<Outcome, string> = { pass: GOOD, fail: BAD, skip: '#c7c7cc', info: '#5a8dee' };

export function Bar({ done, failed, total }: { done: number; failed: number; total: number }) {
  const width = (n: number) => `${total === 0 ? 0 : Math.min(100, (n / total) * 100)}%` as const;
  return (
    <View style={s.bar}>
      <View style={[s.barFill, { width: width(done), backgroundColor: GOOD }]} />
      <View style={[s.barFill, { left: width(done), width: width(failed), backgroundColor: BAD }]} />
    </View>
  );
}

export function Pill({ label, on }: { label: string; on: boolean | null }) {
  return (
    <View style={s.pill}>
      <View style={[s.pillDot, { backgroundColor: on === null ? '#c7c7cc' : on ? GOOD : BAD }]} />
      <Text style={s.pillText}>{label}</Text>
    </View>
  );
}

export function Card({ number, title, status, summary, open, onToggle, children }: { number: number | string; title: string; status: StepStatus; summary?: string; open: boolean; onToggle: () => void; children?: ReactNode }) {
  return (
    <View style={[s.card, status === 'todo' && s.cardActive, status === 'locked' && s.cardLocked]}>
      <Pressable onPress={onToggle} style={s.head} hitSlop={6}>
        <View style={[s.badge, { backgroundColor: TONE[status] }]}>
          <Text style={s.badgeText}>{status === 'done' ? '✓' : status === 'fail' ? '!' : number}</Text>
        </View>
        <Text style={s.title} numberOfLines={1}>{title}</Text>
        {summary ? <Text style={[s.summary, status === 'fail' && { color: BAD }]}>{summary}</Text> : null}
        <Text style={s.chevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? <View style={s.body}>{children}</View> : null}
    </View>
  );
}

export function Primary({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [s.primary, disabled && s.off, pressed && { opacity: 0.85 }]}>
      <Text style={s.primaryText}>{label}</Text>
    </Pressable>
  );
}

export function Ghost({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[s.ghost, disabled && s.off]} hitSlop={6}>
      <Text style={s.ghostText}>{label}</Text>
    </Pressable>
  );
}

export const Note = ({ children }: { children: ReactNode }) => <Text style={s.note}>{children}</Text>;

export function Rows({ items, all, onRun }: { items: { id: string; title: string; entry?: ReportEntry }[]; all: boolean; onRun?: (id: string) => void }) {
  const shown = all ? items : [];
  if (shown.length === 0) return null;
  return (
    <View style={s.rows}>
      {shown.map(({ id, title, entry }) => (
        <View key={id} style={s.row}>
          <View style={[s.rowDot, { backgroundColor: entry ? DOT[entry.outcome] : '#e5e5ea' }]} />
          <View style={s.rowText}>
            <Text style={s.rowTitle} numberOfLines={all ? 2 : 3}>{title}</Text>
            {entry && (entry.outcome === 'fail' || all) && (entry.value || entry.note) ? (
              <Text style={[s.rowNote, entry.outcome === 'fail' && { color: BAD }]} numberOfLines={all ? 3 : 8}>{[entry.value ? `${entry.value}${entry.unit ? ` ${entry.unit}` : ''}` : '', entry.note ?? ''].filter(Boolean).join(' · ')}</Text>
            ) : null}
            {onRun && entry?.outcome === 'fail' ? (
              <Pressable onPress={() => onRun(id)}>
                <Text style={[s.rowNote, { color: ACCENT, fontWeight: '600' }]}>Yalnızca bunu çalıştır</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function Dock({ text, onStop }: { text: string; onStop: () => void }) {
  return (
    <View style={s.dock}>
      <Text style={s.dockText} numberOfLines={2}>{text}</Text>
      <Pressable onPress={onStop} hitSlop={8}>
        <Text style={s.dockStop}>Durdur</Text>
      </Pressable>
    </View>
  );
}

export const palette = { INK, MUTED, ACCENT, GOOD, BAD, LINE };

const s = StyleSheet.create({
  bar: { height: 6, borderRadius: 3, backgroundColor: LINE, overflow: 'hidden' },
  barFill: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: LINE },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontSize: 12, color: INK },
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: LINE, paddingHorizontal: 14, paddingVertical: 12 },
  cardActive: { borderColor: ACCENT },
  cardLocked: { opacity: 0.55 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: INK },
  summary: { fontSize: 12, color: MUTED },
  chevron: { fontSize: 12, color: MUTED, width: 12, textAlign: 'center' },
  body: { marginTop: 12, gap: 10 },
  primary: { backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  ghost: { alignSelf: 'flex-start', paddingVertical: 2 },
  ghostText: { color: ACCENT, fontSize: 13, fontWeight: '600' },
  off: { opacity: 0.35 },
  note: { fontSize: 12.5, color: MUTED, lineHeight: 17 },
  rows: { gap: 8 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  rowDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 13, color: INK },
  rowNote: { fontSize: 12, color: MUTED },
  dock: { position: 'absolute', left: 12, right: 12, bottom: 28, backgroundColor: 'rgba(28,28,30,0.94)', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dockText: { flex: 1, color: '#fff', fontSize: 13 },
  dockStop: { color: '#ff8a4c', fontWeight: '700', fontSize: 14 },
});
