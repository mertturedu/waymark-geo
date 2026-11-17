import { reportList } from '../device-test/report-list';
import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';
import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatReport, type Outcome, type ReportEntry } from '../../../src/core';
import { Bar, Card, Dock, Ghost, Note, palette, Pill, Primary, Rows } from './ui';
import { deviceInfo, sdkInfo } from '../device-test/env';
import { buildReport, runTest } from '../device-test/runner';
import { loadEntries, loadMemory, reportsDirectory, saveEntries, saveMemory, saveReport, resetTestState } from '../device-test/storage';
import { probeServer } from '../device-test/tests/env';
import type { DeviceTest, TestContext } from '../device-test/types';
import { FALLBACK_SERVER } from '../device-test/server-url';
import { useServer } from '../sdk/server';
import { carriedEntries, isSettled, type Memory } from './answers';
import { sdkGuideSteps, type SdkStepId } from './guide';
import { MapTourOverlay } from './map-tour/MapTourOverlay';
import { AUTO_TESTS, OFFLINE_AUTO_TESTS, RESTART_TESTS, sdkRegistry } from './registry';
import { pickTests, reportEndpoint, type RunRequest } from './autorun';
import { useRunPolling, useRunRequests } from './launch';

const TIMEOUT_MS = 10 * 60 * 1000;
const FOCUS = ['sdk.map-look', 'sdk.remove-frees', 'sdk.map-zoom-ladder', 'sdk.map-motion', 'sdk.rot-layout', 'sdk.sim-drive', 'sdk.sim-ring', 'sdk.sim-replan'];

export function SdkTestScreen() {
  const server = useServer();
  const [serverOk, setServerOk] = useState(false);
  const [entries, setEntries] = useState<Record<string, ReportEntry>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [ran, setRan] = useState<string[]>([]);
  const [batch, setBatch] = useState<{ total: number; done: number } | null>(null);
  const [status, setStatus] = useState('');
  const [memory, setMemory] = useState<Memory>({ answers: {}, notes: {} });
  const [showSettled, setShowSettled] = useState(false);
  const notes = memory.notes;
  const [online, setOnline] = useState<boolean | null>(null);
  const [typed, setTyped] = useState(FALLBACK_SERVER);
  const [log, setLog] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const stopped = useRef(false);

  useEffect(() => {
    loadEntries().then((saved) => setEntries((previous) => ({ ...saved, ...previous })), () => undefined);
  }, []);

  useEffect(() => {
    loadMemory().then(setMemory, () => undefined);
  }, []);

  const remember = useCallback((change: (previous: Memory) => Memory) => {
    setMemory((previous) => {
      const next = change(previous);
      saveMemory(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const check = () => Network.getNetworkStateAsync().then((state) => setOnline(Boolean(state.isConnected)), () => undefined);
    void check();
    const timer = setInterval(check, 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (running === null) return undefined;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const probe = useCallback(async () => {
    if (!server.url) return setStatus('Sunucu adresi yok. Ayarlar sekmesinden yaz.');
    const result = await probeServer(server.url, 4000);
    setServerOk(result.ok);
    setStatus(result.ok ? `Sunucuya ulaşıldı: ${server.url} (${result.ms} ms)` : `Sunucuya ulaşılamadı: ${result.note}`);
  }, [server.url]);

  useEffect(() => {
    if (server.ready) void probe();
  }, [server.ready, probe]);

  const ctx = useMemo<TestContext>(() => ({ packServerUrl: server.url, packsDir: '', reportDir: reportsDirectory().uri, log: (line) => setLog((previous) => [...previous.slice(-30), line]) }), [server.url]);

  const record = useCallback((entry: ReportEntry) => {
    setEntries((previous) => {
      const next = { ...previous, [entry.id]: entry };
      saveEntries(next);
      return next;
    });
  }, []);

  const runList = async (tests: DeviceTest[]): Promise<ReportEntry[]> => {
    stopped.current = false;
    setRan(tests.map((t) => t.id));
    setBatch({ total: tests.length, done: 0 });
    const done: ReportEntry[] = [];
    for (const [index, test] of tests.entries()) {
      if (stopped.current) break;
      setRunning(test.id);
      const entry = await runTest(test, ctx, TIMEOUT_MS);
      done.push(entry);
      record(entry);
      setBatch({ total: tests.length, done: index + 1 });
    }
    setRunning(null);
    return done;
  };

  const [request, setRequest] = useState<RunRequest | null>(null);
  useRunRequests(setRequest);
  useRunPolling(server.ready ? server.url : null, running === null);

  useEffect(() => {
    const handedIn = request !== null && request.ids !== 'auto' && request.ids.length === 1 && request.ids[0] === 'sdk.addr-hints' && new File(new Directory(Paths.document, 'hints-input'), 'hints.json').exists;
    if (!request || (!handedIn && (!server.ready || !server.url)) || running !== null) return;
    const target = server.ready && server.url ? server.url : null;
    const { tests, missing } = pickTests(request, sdkRegistry, AUTO_TESTS);
    setRequest(null);
    void (async () => {
      const done = await runList(tests);
      const report = buildReport([...done, ...missing], { device: deviceInfo(), sdk: sdkInfo(null), now: new Date() });
      const text = formatReport(report);
      saveReport(report.reportId, text);
      if (!target) return;
      try {
        const response = await fetch(reportEndpoint(target), { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text });
        setStatus(response.ok ? `Rapor sunucuya gönderildi: ${report.reportId}` : `Rapor gönderilemedi (${response.status})`);
      } catch (error) {
        setStatus(`Rapor gönderilemedi: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  }, [request, server.ready, server.url, running]);

  const answer = (test: DeviceTest, outcome: Outcome) => {
    const note = (notes[test.id] ?? '').trim();
    record({ id: test.id, title: test.title, kind: 'manual', outcome, ...(note ? { note } : {}) });
    remember((previous) => ({ ...previous, answers: { ...previous.answers, [test.id]: { outcome, rev: test.rev ?? 1, ...(note ? { note } : {}) } } }));
  };

  const resetAll = () => {
    resetTestState();
    setEntries({});
    setMemory({ answers: {}, notes: {} });
    setRan([]);
    setBatch(null);
    setLog([]);
    setStatus('Sıfırlandı. Her şey 0\'dan başlıyor.');
  };

  const copyReport = async (only?: string[]) => {
    const all = reportList(sdkRegistry, { ...carriedEntries(sdkRegistry, memory, entries), ...entries }, notes);
    const list = only ? all.filter((entry) => only.includes(entry.id)) : all;
    const report = buildReport(list, { device: deviceInfo(), sdk: sdkInfo(null), now: new Date() });
    const text = formatReport(report);
    saveReport(report.reportId, text);
    await Clipboard.setStringAsync(text);
    setStatus(`Kopyalandı: ${report.reportId} (${list.length} kayıt). Şimdi sohbete yapıştır.`);
  };

  const effective = { ...carriedEntries(sdkRegistry, memory, entries), ...entries };
  const steps = sdkGuideSteps({ serverOk, entries: effective, online, autoIds: AUTO_TESTS.map((t) => t.id), restartIds: RESTART_TESTS.map((t) => t.id), offlineAutoIds: OFFLINE_AUTO_TESTS.map((t) => t.id) });
  const stepOf = (id: SdkStepId) => steps.find((s) => s.id === id)!;
  const numberOf = (id: SdkStepId) => steps.findIndex((s) => s.id === id) + 1;
  const busy = running !== null;
  const allTests = [...AUTO_TESTS, ...RESTART_TESTS, ...OFFLINE_AUTO_TESTS];
  const focusTests = FOCUS.map((id) => allTests.find((t) => t.id === id)).filter((t): t is DeviceTest => t !== undefined);
  const ranFail = ran.filter((id) => effective[id]?.outcome === 'fail').length;
  const batchLine =
    busy && batch
      ? `Devam ediyor: ${batch.done + 1}/${batch.total} · ${running} · ${elapsed} sn`
      : batch && ran.length > 0
        ? `Bitti: ${batch.done}/${batch.total} çalıştı, ${batch.done - ranFail} geçti, ${ranFail} hata`
        : 'Henüz bir şey çalıştırılmadı';

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [listed, setListed] = useState<Record<string, boolean>>({});
  const isOpen = (id: SdkStepId) => expanded[id] ?? (stepOf(id).status === 'todo' || stepOf(id).status === 'fail');
  const toggle = (id: SdkStepId) => setExpanded((previous) => ({ ...previous, [id]: !isOpen(id) }));

  const tally = (list: DeviceTest[]) => {
    const pass = list.filter((t) => effective[t.id]?.outcome === 'pass' || effective[t.id]?.outcome === 'info').length;
    const fail = list.filter((t) => effective[t.id]?.outcome === 'fail').length;
    return { pass, fail, total: list.length };
  };
  const label = (list: DeviceTest[]) => {
    const t = tally(list);
    return t.fail > 0 ? `${t.fail} hata · ${t.pass}/${t.total}` : `${t.pass}/${t.total}`;
  };

  const card = (id: SdkStepId, title: string, body: React.ReactNode, tests?: DeviceTest[]) => {
    const step = stepOf(id);
    return (
      <Card number={numberOf(id)} title={title} status={step.status} {...(tests ? { summary: label(tests) } : {})} open={isOpen(id)} onToggle={() => toggle(id)}>
        {step.status === 'locked' && step.blocker ? <Note>{step.blocker}</Note> : null}
        {body}
      </Card>
    );
  };

  const results = (id: string, list: DeviceTest[]) => (
    <>
      <Rows items={list.map((t) => ({ id: t.id, title: t.title, ...(effective[t.id] ? { entry: effective[t.id] } : {}) }))} all={Boolean(listed[id])} />
      <Ghost label={listed[id] ? 'Yalnızca hataları göster' : `Tüm sonuçları göster (${list.length})`} onPress={() => setListed((previous) => ({ ...previous, [id]: !previous[id] }))} />
    </>
  );

  const question = (t: DeviceTest, locked: boolean) => (
    <View key={t.id} style={styles.question}>
      <Text style={styles.questionTitle}>{t.title}</Text>
      <Note>{t.question}</Note>
      <TextInput style={styles.input} placeholder="Not (isteğe bağlı)" placeholderTextColor={palette.MUTED} value={notes[t.id] ?? ''} onChangeText={(text) => remember((previous) => ({ ...previous, notes: { ...previous.notes, [t.id]: text } }))} />
      <View style={styles.actions}>
        {(['pass', 'fail'] as const).map((outcome) => {
          const current = entries[t.id]?.outcome ?? (isSettled(t, memory) ? 'pass' : null);
          return (
            <Pressable key={outcome} disabled={locked} onPress={() => answer(t, outcome)} style={[styles.choice, current === outcome && (outcome === 'pass' ? styles.choiceYes : styles.choiceNo), locked && { opacity: 0.4 }]}>
              <Text style={[styles.choiceText, current === outcome && { color: '#fff' }]}>{outcome === 'pass' ? 'Evet' : 'Hayır'}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const questions = (list: DeviceTest[], locked: boolean) => {
    const open = list.filter((t) => !isSettled(t, memory) || entries[t.id]);
    const settled = list.filter((t) => isSettled(t, memory) && !entries[t.id]);
    return (
      <>
        {open.map((t) => question(t, locked))}
        {settled.length > 0 ? <Ghost label={`${showSettled ? 'Geçen soruları gizle' : 'Geçen sorular'} (${settled.length})`} onPress={() => setShowSettled((value) => !value)} /> : null}
        {showSettled ? settled.map((t) => question(t, locked)) : null}
      </>
    );
  };

  const all = [...AUTO_TESTS, ...RESTART_TESTS, ...OFFLINE_AUTO_TESTS];
  const total = tally(all);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.page} bounces={false} overScrollMode="never">
        <Text style={styles.heading}>SDK Testi</Text>
        <Bar done={total.pass} failed={total.fail} total={total.total} />
        <View style={styles.meta}>
          <Text style={styles.count}>{`${total.pass} / ${total.total} geçti${total.fail > 0 ? ` · ${total.fail} hata` : ''}`}</Text>
          <View style={styles.pills}>
            <Pill label="Sunucu" on={server.url ? serverOk : null} />
            <Pill label={online === null ? 'Ağ' : online ? 'Ağ açık' : 'Ağ kapalı'} on={online} />
          </View>
        </View>
        {status ? <Text style={styles.status}>{status}</Text> : null}

        {card(
          'server',
          'Sunucu',
          <>
            <Text style={styles.live}>{server.url || 'adres yok'}</Text>
            <TextInput style={styles.input} value={typed} onChangeText={setTyped} placeholder="http://192.168.1.110:8090" placeholderTextColor={palette.MUTED} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Primary label="Bu adresi kullan" onPress={() => server.set(typed)} disabled={busy || typed.trim() === ''} />
            <Ghost label="Sunucuyu dene" onPress={() => void server.find().then(probe)} disabled={busy} />
          </>,
        )}

        {card(
          'auto',
          'Otomatik testler',
          <>
            <Note>Harita turu ve rotasyon testleri sırasında ekrana dokunma. Yaklaşık 40 dakika.</Note>
            <Primary label="Çalıştır" onPress={() => void runList(AUTO_TESTS)} disabled={busy || stepOf('auto').status === 'locked'} />
            {results('auto', AUTO_TESTS)}
          </>,
          AUTO_TESTS,
        )}

        {card(
          'restart',
          'Yeniden aç, öğrenme 2/2',
          <>
            <Note>Uygulamayı çok görevli ekranından kapat, yeniden aç, buraya gel.</Note>
            <Primary label="Öğrenme 2/2" onPress={() => void runList(RESTART_TESTS)} disabled={busy || stepOf('restart').status === 'locked'} />
            {results('restart', RESTART_TESTS)}
          </>,
          RESTART_TESTS,
        )}

        {card(
          'airplane',
          'Uçak modu',
          <Note>{online === null ? 'Ağ durumu okunuyor…' : online ? 'Uçak modunu aç, sonra Wi-Fi’ı kapat.' : 'Ağ kapalı, hazır.'}</Note>,
        )}

        {card(
          'offline-auto',
          'Uçak modunda otomatik testler',
          <>
            <Note>Aynı testler ağ kapalıyken koşar; ağ isteği denenirse test kalır. Yaklaşık 30 dakika.</Note>
            <Primary label="Çalıştır" onPress={() => void runList(OFFLINE_AUTO_TESTS)} disabled={busy || stepOf('offline-auto').status === 'locked'} />
            {results('offline-auto', OFFLINE_AUTO_TESTS)}
          </>,
          OFFLINE_AUTO_TESTS,
        )}

        <Card number="⋯" title="Spesifik çalıştır" status="todo" open={pickOpen} onToggle={() => setPickOpen((value) => !value)}>
          <Text style={styles.live}>{batchLine}</Text>
          <Primary label={`Çalıştır (${focusTests.length} test)`} onPress={() => void runList(focusTests)} disabled={busy} />
          <Ghost label="Bu çalıştırmanın raporunu kopyala" onPress={() => void copyReport(ran)} disabled={busy || ran.length === 0} />
        </Card>

        <Card number="↺" title="Sıfırla" status="todo" open={resetOpen} onToggle={() => setResetOpen((value) => !value)}>
          <Note>Tüm sonuçları, cevapları ve indirilen test paketlerini siler. Her şey 0'dan başlar.</Note>
          <Primary label="Baştan başla" onPress={resetAll} disabled={busy} />
        </Card>

        {card(
          'report',
          'Rapor',
          <Primary label="Raporu kopyala" onPress={() => void copyReport()} disabled={stepOf('report').status === 'locked'} />,
        )}
        {log.length > 0 && busy ? <Text style={styles.log}>{log.slice(-6).join('\n')}</Text> : null}
      </ScrollView>
      {busy ? <Dock text={`${running} · ${elapsed} sn`} onStop={() => void (stopped.current = true)} /> : null}
      <MapTourOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f6f6f7' },
  page: { padding: 16, paddingTop: Platform.OS === 'ios' ? 64 : 32, gap: 12, paddingBottom: 120 },
  heading: { fontSize: 28, fontWeight: '800', color: palette.INK, letterSpacing: -0.5 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  count: { fontSize: 13, color: palette.MUTED },
  pills: { flexDirection: 'row', gap: 6 },
  input: { borderWidth: 1, borderColor: palette.LINE, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: palette.INK, backgroundColor: '#fafafa' },
  status: { color: palette.GOOD, fontSize: 13 },
  live: { fontSize: 14, fontWeight: '600', color: palette.INK },
  question: { gap: 8, paddingTop: 4 },
  questionTitle: { fontSize: 14, fontWeight: '600', color: palette.INK },
  actions: { flexDirection: 'row', gap: 8 },
  choice: { flex: 1, borderWidth: 1, borderColor: palette.LINE, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  choiceYes: { backgroundColor: palette.GOOD, borderColor: palette.GOOD },
  choiceNo: { backgroundColor: palette.BAD, borderColor: palette.BAD },
  choiceText: { fontWeight: '600', color: palette.INK },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  pickDot: { width: 10, height: 10, borderRadius: 5 },
  pickId: { fontSize: 11, color: palette.MUTED },
  pickTitle: { fontSize: 13, color: palette.INK },
  log: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, color: palette.MUTED },
});
