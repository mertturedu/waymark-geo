import { reportList } from './report-list';
import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatReport, type Outcome, type ReportEntry } from '../../../src/core';
import { deviceInfo, sdkInfo } from './env';
import { registry } from './registry';
import { buildReport, runTest } from './runner';
import { loadEntries, loadManifest, loadServerUrl, packsDirectory, reportsDirectory, saveEntries, saveReport, saveServerUrl } from './storage';
import { candidateUrls, findServer } from './find-server';
import { Button, Help, StepCard, TestRow } from './GuideParts';
import { guideSteps, type StepId } from './guide';
import { missingFiles } from './install-list';
import { FALLBACK_SERVER, normalizeServerUrl, resolveServerUrl } from './server-url';
import { makeStallMonitor } from './stall';
import { makeWorkTracker } from './work-tracker';
import { probeServer } from './tests/env';
import { installAll } from './tests/pack-download';
import type { DeviceTest, TestContext } from './types';

const TIMEOUT_MS = 10 * 60 * 1000;
const STALL_NOTE_MS = 1000;
const DEFAULT_SERVERS = [process.env.EXPO_PUBLIC_PACK_SERVER_URLS, process.env.EXPO_PUBLIC_PACK_SERVER_URL, FALLBACK_SERVER].filter(Boolean).join(',');
const DEFAULT_SERVER = candidateUrls('', DEFAULT_SERVERS)[0];

const MAP_TEST_IDS = ['d1.pmtiles-file', 'd1.net-state', 'd1.map-events'];
const byId = (id: string) => registry.find((t) => t.id === id) as DeviceTest;
const INTERNET_TESTS = registry.filter((t) => t.kind === 'auto' && !t.id.startsWith('d1.'));
const MAP_TESTS = MAP_TEST_IDS.map(byId);
const QUESTIONS = registry.filter((t) => t.kind === 'manual');

function newStop() {
  let trigger = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    trigger = () => {
      state.stopped = true;
      resolve();
    };
  });
  const state = { stopped: false, trigger, promise };
  return state;
}

export function DeviceTestScreen({ mapOpened, onOpenMap }: { mapOpened: boolean; onOpenMap: () => void }) {
  const [serverUrl, setServerUrl] = useState('');
  const [serverOk, setServerOk] = useState(false);
  const [entries, setEntries] = useState<Record<string, ReportEntry>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [online, setOnline] = useState<boolean | null>(null);
  const [packsMissing, setPacksMissing] = useState<number | null>(null);
  const [working, setWorking] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const tracker = useRef(makeWorkTracker(setWorking)).current;
  const stall = useRef(makeStallMonitor({ now: Date.now, everyMs: 250 })).current;
  const stopRef = useRef<{ stopped: boolean; trigger: () => void; promise: Promise<void> }>(newStop());

  const refreshPacks = useCallback(async () => {
    const manifest = await loadManifest().catch(() => null);
    if (!manifest) return setPacksMissing(null);
    const root = packsDirectory().uri.replace(/\/$/, '');
    setPacksMissing(
      missingFiles(manifest, (path) => {
        const file = new File(`${root}/${path}`);
        return file.exists ? file.size : null;
      }),
    );
  }, []);

  useEffect(() => {
    loadEntries().then((saved) => setEntries((previous) => ({ ...saved, ...previous })), () => undefined);
    void refreshPacks();
  }, [refreshPacks]);

  useEffect(() => {
    const check = () => Network.getNetworkStateAsync().then((state) => setOnline(Boolean(state.isConnected)), () => undefined);
    void check();
    const timer = setInterval(check, 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(stall.tick, 250);
    const appState = AppState.addEventListener('change', stall.reset);
    return () => {
      clearInterval(timer);
      appState.remove();
    };
  }, [stall]);

  useEffect(() => {
    if (running === null) return undefined;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    const start = (saved: string) => {
      const initial = resolveServerUrl(saved, DEFAULT_SERVER);
      setServerUrl(initial);
      void probe(initial);
    };
    loadServerUrl().then(start, () => start(''));
  }, []);

  const ctx = useMemo<TestContext>(
    () => ({
      packServerUrl: normalizeServerUrl(serverUrl) ?? '',
      packsDir: packsDirectory().uri,
      reportDir: reportsDirectory().uri,
      log: (line) => setLog((previous) => [...previous.slice(-40), line]),
    }),
    [serverUrl],
  );

  const record = useCallback((entry: ReportEntry) => {
    setEntries((previous) => {
      const next = { ...previous, [entry.id]: entry };
      saveEntries(next);
      return next;
    });
  }, []);

  const runAuto = useCallback(
    async (test: DeviceTest) => {
      setRunning(test.id);
      stall.reset();
      const skipped = stopRef.current.promise.then((): ReportEntry => ({ id: test.id, title: test.title, kind: test.kind, outcome: 'skip', note: 'durduruldu' }));
      const entry = await Promise.race([tracker.track(runTest(test, ctx, TIMEOUT_MS)), skipped]);
      const slow = stall.note(STALL_NOTE_MS);
      record(slow ? { ...entry, note: entry.note ? `${entry.note}; ${slow}` : slow } : entry);
      setRunning(null);
      if (test.id.startsWith('d4.')) void refreshPacks();
    },
    [ctx, record, stall, tracker, refreshPacks],
  );

  const runList = useCallback(
    async (tests: DeviceTest[]) => {
      stopRef.current = newStop();
      for (const test of tests) {
        if (stopRef.current.stopped) break;
        await runAuto(test);
      }
    },
    [runAuto],
  );

  const stop = () => {
    stopRef.current.trigger();
    setStatus('Durdurma istendi. Süren iş bitince duracak, o zamana kadar düğmeler kapalı kalır.');
  };

  const answer = (test: DeviceTest, outcome: Outcome) =>
    record({ id: test.id, title: test.title, kind: 'manual', outcome, ...(notes[test.id] ? { note: notes[test.id] } : {}) });

  const install = async () => {
    stopRef.current = newStop();
    setRunning('paket indirme');
    stall.reset();
    try {
      const token = stopRef.current;
      const result = await tracker.track(installAll(ctx, (line) => setStatus(line), () => token.stopped));
      setStatus(`Paketler hazır: ${result.files} dosya, ${result.retries} yeniden deneme, en uzun takılma ${stall.maxStallMs()} ms`);
    } catch (error) {
      setStatus(`Paket indirme hatası: ${error instanceof Error ? error.message : String(error)}`);
    }
    setRunning(null);
    void refreshPacks();
  };

  const probe = async (typed: string = serverUrl) => {
    setStatus('Sunucu aranıyor…');
    const found = await findServer(candidateUrls(typed, DEFAULT_SERVERS), (url) => probeServer(url, 4000));
    const lines = found.attempts.map((a) => `${a.ok ? 'OK' : 'yok'} ${a.url}: ${a.note}`);
    setServerOk(Boolean(found.url));
    if (found.url) {
      setServerUrl(found.url);
      saveServerUrl(found.url);
      setStatus([`Sunucuya ulaşıldı: ${found.url}`, ...lines].join('\n'));
    } else {
      setStatus(['Sunucuya ulaşılamadı.', ...lines].join('\n'));
    }
  };

  const copyReport = async () => {
    const list = reportList(registry, entries, notes);
    const report = buildReport(list, { device: deviceInfo(), sdk: sdkInfo(null), now: new Date() });
    const text = formatReport(report);
    saveReport(report.reportId, text);
    await Clipboard.setStringAsync(text);
    setStatus(`Kopyalandı: ${report.reportId} (${list.length} test). Şimdi sohbete yapıştır.`);
  };

  const steps = guideSteps({
    serverOk,
    packsMissing,
    entries,
    online,
    mapOpened,
    internetTests: INTERNET_TESTS.map((t) => t.id),
    mapTests: MAP_TEST_IDS,
    questions: QUESTIONS.map((t) => t.id),
  });
  const stepOf = (id: StepId) => steps.find((s) => s.id === id)!;
  const number = (id: StepId) => steps.findIndex((s) => s.id === id) + 1;
  const busy = running !== null || working > 0;

  const card = (id: StepId, title: string, body: React.ReactNode) => {
    const step = stepOf(id);
    return (
      <StepCard number={number(id)} title={title} status={step.status} {...(step.blocker ? { blocker: step.blocker } : {})}>
        {body}
      </StepCard>
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.page} bounces={false} overScrollMode="never">
      <Text style={styles.heading}>Cihaz Testi</Text>
      <Help>Adımları sırayla yap. Sırası gelen adımın çerçevesi turuncudur. Bitince Raporu kopyala ve sohbete yapıştır.</Help>
      {busy ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{`${running !== null ? `Çalışıyor: ${running}` : 'Durduruluyor, süren iş bitiyor'} (${elapsed} sn, en uzun takılma ${stall.maxStallMs()} ms). Bitene kadar düğmeler kapalı.`}</Text>
          <Button label="Durdur" onPress={stop} />
        </View>
      ) : null}
      {status ? <Text style={styles.status}>{status}</Text> : null}

      {card(
        'server',
        'Sunucuya bağlan',
        <>
          <Help>Mac'te "npm run serve:packs" açık olmalı. Uygulama adresi kendisi arar, bulamazsa aşağıya yaz.</Help>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={(text) => {
              setServerUrl(text);
              saveServerUrl(text);
            }}
            placeholder="http://192.168.1.110:8090"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          {serverUrl !== '' && ctx.packServerUrl === '' ? <Text style={styles.bad}>Adres geçersiz</Text> : null}
          <Button label="Sunucuyu dene" onPress={() => probe()} disabled={busy} />
        </>,
      )}

      {card(
        'packs',
        'Paketleri indir',
        <>
          <Help>Harita, sokak veritabanı, yazı ve simge dosyaları iner (yaklaşık 200 MB). Kesilirse tekrar bas, kaldığı yerden devam eder.</Help>
          <Help>{packsMissing === null ? 'Henüz indirilmedi.' : packsMissing === 0 ? 'Tüm dosyalar telefonda.' : `Eksik dosya: ${packsMissing}`}</Help>
          <Button label="Paketleri indir" onPress={install} disabled={busy || stepOf('packs').status === 'locked'} />
        </>,
      )}

      {card(
        'online-tests',
        'İnternetli testleri çalıştır',
        <>
          <Help>Bu testler sunucuya bağlanır ve telefonu ölçer. 3 ile 5 dakika sürer, en uzunu rota hızı testidir. Takılırsa Durdur'a bas ve bana yaz.</Help>
          {INTERNET_TESTS.map((t) => (
            <TestRow key={t.id} title={t.title} id={t.id} {...(entries[t.id] ? { entry: entries[t.id] } : {})} />
          ))}
          <Button label="Testleri çalıştır" onPress={() => runList(INTERNET_TESTS)} disabled={busy || stepOf('online-tests').status === 'locked'} />
        </>,
      )}

      {card(
        'airplane',
        "Uçak modunu aç, Wi-Fi'ı kapat",
        <>
          <Help>Kontrol Merkezi'nden uçak modunu aç, sonra Wi-Fi simgesine basıp kapat. Ağ kapanınca bu kutu kendiliğinden yeşile döner.</Help>
          <Text style={styles.live}>{online === null ? 'Ağ durumu okunuyor…' : online ? 'Şu an ağ AÇIK' : 'Şu an ağ KAPALI'}</Text>
        </>,
      )}

      {card(
        'map',
        'Haritayı aç ve dene',
        <>
          <Help>Harita sekmesinde sırayla dene: Kadıköy düğmesi, İstanbul düğmesi (uzaklaştır, kaydır), Yazı: original ve compact, dil düğmesi (tr, en, ar), koyu tema. Sonra Cihaz Testi sekmesine dön.</Help>
          <Button label="Haritayı aç" onPress={onOpenMap} disabled={stepOf('map').status === 'locked'} />
        </>,
      )}

      {card(
        'map-tests',
        'Harita testlerini çalıştır',
        <>
          <Help>Üç otomatik kontrol: harita dosyası geçerli mi, ağ gerçekten kapalı mı, harita stili yüklendi mi.</Help>
          {MAP_TESTS.map((t) => (
            <TestRow key={t.id} title={t.title} id={t.id} {...(entries[t.id] ? { entry: entries[t.id] } : {})} />
          ))}
          <Button label="Harita testlerini çalıştır" onPress={() => runList(MAP_TESTS)} disabled={busy || stepOf('map-tests').status === 'locked'} />
        </>,
      )}

      {card(
        'questions',
        'Soruları yanıtla',
        <>
          <Help>Haritada gördüklerine göre Evet ya da Hayır de. Hayır dersen nota kısaca yaz.</Help>
          {QUESTIONS.map((t) => (
            <View key={t.id} style={styles.question}>
              <Text style={styles.questionTitle}>{t.title}</Text>
              <Text style={styles.questionText}>{t.question}</Text>
              {entries[t.id] ? <Text style={styles.answered}>{`Cevap: ${entries[t.id]!.outcome === 'pass' ? 'Evet' : 'Hayır'}`}</Text> : null}
              <TextInput style={styles.input} placeholder="Not (cevaplamasan da rapora girer)" value={notes[t.id] ?? ''} onChangeText={(text) => setNotes((previous) => ({ ...previous, [t.id]: text }))} />
              <View style={styles.actions}>
                <Button label="Evet" onPress={() => answer(t, 'pass')} disabled={stepOf('questions').status === 'locked'} />
                <Button label="Hayır" onPress={() => answer(t, 'fail')} disabled={stepOf('questions').status === 'locked'} />
              </View>
            </View>
          ))}
        </>,
      )}

      {card(
        'report',
        'Raporu kopyala',
        <>
          <Help>Panoya kopyalar. Sohbete yapıştırıp gönder. İstediğin kadar tekrar kopyalayabilirsin.</Help>
          <Button label="Raporu kopyala" onPress={copyReport} disabled={stepOf('report').status === 'locked'} />
        </>,
      )}

      <Button label={showAll ? 'Ayrıntıyı gizle' : 'Tüm testlerin ayrıntısı'} onPress={() => setShowAll((value) => !value)} />
      {showAll
        ? registry.map((test) => (
            <View key={test.id} style={styles.detail}>
              <TestRow title={test.title} id={test.id} {...(entries[test.id] ? { entry: entries[test.id] } : {})} />
              {test.kind === 'auto' ? <Button label="Bunu çalıştır" onPress={() => runList([test])} disabled={busy} /> : null}
            </View>
          ))
        : null}
      {log.length > 0 ? <Text style={styles.log}>{log.join('\n')}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: Platform.OS === 'ios' ? 64 : 32, gap: 12, paddingBottom: 40 },
  heading: { fontSize: 24, fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#bbb', borderRadius: 8, padding: 10, fontSize: 14 },
  status: { color: '#1b8a3a' },
  bad: { color: '#c62828' },
  banner: { backgroundColor: '#fff3e0', borderRadius: 8, padding: 10, gap: 8 },
  bannerText: { fontSize: 13 },
  live: { fontSize: 15, fontWeight: '700' },
  question: { borderTopWidth: 1, borderColor: '#eee', paddingTop: 8, gap: 6 },
  questionTitle: { fontSize: 14, fontWeight: '600' },
  questionText: { fontSize: 13, color: '#444' },
  answered: { fontSize: 13, fontWeight: '700', color: '#1b8a3a' },
  actions: { flexDirection: 'row', gap: 8 },
  detail: { gap: 6 },
  log: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, color: '#444' },
});
