import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Outcome, ReportEntry } from '../../../src/core';
import type { StepStatus } from './guide';

export const OUTCOME_COLORS: Record<Outcome, string> = { pass: '#1b8a3a', fail: '#c62828', skip: '#777777', info: '#1565c0' };

const STATUS_LABEL: Record<StepStatus, string> = { locked: 'Kilitli', todo: 'Sıra sende', done: 'Tamam', fail: 'Hata var' };
const STATUS_COLOR: Record<StepStatus, string> = { locked: '#9e9e9e', todo: '#ff5b04', done: '#1b8a3a', fail: '#c62828' };

export function Button({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.button, disabled && styles.buttonOff]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

export function StepCard({ number, title, status, blocker, children }: { number: number; title: string; status: StepStatus; blocker?: string; children?: ReactNode }) {
  return (
    <View style={[styles.card, status === 'todo' && styles.cardActive, status === 'locked' && styles.cardLocked]}>
      <View style={styles.head}>
        <Text style={[styles.number, { backgroundColor: STATUS_COLOR[status] }]}>{number}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={[styles.chip, { backgroundColor: STATUS_COLOR[status] }]}>{STATUS_LABEL[status]}</Text>
      </View>
      {status === 'locked' && blocker ? <Text style={styles.blocker}>{blocker}</Text> : null}
      {children}
    </View>
  );
}

export const Help = ({ children }: { children: ReactNode }) => <Text style={styles.help}>{children}</Text>;

export function TestRow({ title, id, entry }: { title: string; id: string; entry?: ReportEntry }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowId}>{id}</Text>
        {entry?.value ? <Text style={styles.rowDetail}>{`${entry.value}${entry.unit ? ` ${entry.unit}` : ''}`}</Text> : null}
        {entry?.note ? <Text style={styles.rowDetail}>{entry.note}</Text> : null}
      </View>
      {entry ? <Text style={[styles.chip, { backgroundColor: OUTCOME_COLORS[entry.outcome] }]}>{entry.outcome}</Text> : <Text style={styles.waiting}>bekliyor</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { backgroundColor: '#ff5b04', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 14, alignSelf: 'flex-start' },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: '#fff', fontWeight: '600' },
  card: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 12, gap: 8 },
  cardActive: { borderColor: '#ff5b04', borderWidth: 2 },
  cardLocked: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  number: { color: '#fff', fontWeight: '700', width: 26, height: 26, borderRadius: 13, textAlign: 'center', lineHeight: 26, overflow: 'hidden' },
  title: { fontSize: 16, fontWeight: '700', flex: 1 },
  chip: { color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden', fontSize: 12 },
  blocker: { color: '#c62828', fontSize: 13 },
  help: { fontSize: 13, color: '#444', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4, borderTopWidth: 1, borderColor: '#eee' },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 13, fontWeight: '600' },
  rowId: { fontSize: 11, color: '#888' },
  rowDetail: { fontSize: 12, color: '#333' },
  waiting: { fontSize: 12, color: '#999' },
});
