import { guideSteps, type GuideState, type GuideStep } from '../../example/src/device-test/guide';

const base: GuideState = {
  serverOk: true,
  packsMissing: 0,
  entries: {},
  online: true,
  mapOpened: false,
  internetTests: ['env.pack-server', 'd4.resume-download'],
  mapTests: ['d1.pmtiles-file', 'd1.net-state', 'd1.map-events'],
  questions: ['d1.map-offline', 'd1.map-dark'],
};

const statusOf = (state: GuideState, id: GuideStep['id']) => guideSteps(state).find((s) => s.id === id)?.status;
const blockerOf = (state: GuideState, id: GuideStep['id']) => guideSteps(state).find((s) => s.id === id)?.blocker;
const pass = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, { outcome: 'pass' as const }]));

describe('guideSteps', () => {
  it('lists the steps in the order the person does them', () => {
    expect(guideSteps(base).map((s) => s.id)).toEqual(['server', 'packs', 'online-tests', 'airplane', 'map', 'map-tests', 'questions', 'report']);
  });

  it('marks the server step done when it answers and todo when it does not', () => {
    expect(statusOf(base, 'server')).toBe('done');
    expect(statusOf({ ...base, serverOk: false }, 'server')).toBe('todo');
  });

  it('locks the pack download until the server answers, unless nothing is missing', () => {
    expect(statusOf({ ...base, serverOk: false, packsMissing: 3 }, 'packs')).toBe('locked');
    expect(blockerOf({ ...base, serverOk: false, packsMissing: 3 }, 'packs')).toBe('Önce sunucuya bağlan');
    expect(statusOf({ ...base, serverOk: false, packsMissing: 0 }, 'packs')).toBe('done');
    expect(statusOf({ ...base, packsMissing: 2 }, 'packs')).toBe('todo');
    expect(statusOf({ ...base, packsMissing: null }, 'packs')).toBe('todo');
  });

  it('keeps the online tests locked until the packs are complete', () => {
    expect(statusOf({ ...base, packsMissing: 2 }, 'online-tests')).toBe('locked');
    expect(blockerOf({ ...base, packsMissing: 2 }, 'online-tests')).toBe('Önce paketleri indir');
    expect(statusOf({ ...base, serverOk: false }, 'online-tests')).toBe('locked');
  });

  it('turns the online tests done only when every one ran without failing', () => {
    expect(statusOf(base, 'online-tests')).toBe('todo');
    expect(statusOf({ ...base, entries: pass('env.pack-server') }, 'online-tests')).toBe('todo');
    expect(statusOf({ ...base, entries: pass('env.pack-server', 'd4.resume-download') }, 'online-tests')).toBe('done');
    expect(statusOf({ ...base, entries: { ...pass('env.pack-server'), 'd4.resume-download': { outcome: 'fail' } } }, 'online-tests')).toBe('fail');
    expect(statusOf({ ...base, entries: { ...pass('env.pack-server'), 'd4.resume-download': { outcome: 'info' } } }, 'online-tests')).toBe('done');
  });

  it('reads the airplane step from the live network state', () => {
    expect(statusOf({ ...base, online: true }, 'airplane')).toBe('todo');
    expect(statusOf({ ...base, online: null }, 'airplane')).toBe('todo');
    expect(statusOf({ ...base, online: false }, 'airplane')).toBe('done');
  });

  it('only opens the map step once the network is off', () => {
    expect(statusOf(base, 'map')).toBe('locked');
    expect(blockerOf(base, 'map')).toBe('Önce uçak modunu aç ve Wi-Fi\'ı kapat');
    expect(statusOf({ ...base, online: false }, 'map')).toBe('todo');
    expect(statusOf({ ...base, online: false, mapOpened: true }, 'map')).toBe('done');
  });

  it('needs the network off and the map opened before the map tests', () => {
    expect(statusOf({ ...base, online: false }, 'map-tests')).toBe('locked');
    expect(blockerOf({ ...base, online: false }, 'map-tests')).toBe('Önce Harita sekmesini aç');
    expect(statusOf({ ...base, online: true, mapOpened: true }, 'map-tests')).toBe('locked');
    expect(statusOf({ ...base, online: false, mapOpened: true }, 'map-tests')).toBe('todo');
  });

  it('marks the map tests fail when one fails and done when all pass', () => {
    const open = { ...base, online: false, mapOpened: true };
    expect(statusOf({ ...open, entries: pass('d1.pmtiles-file', 'd1.net-state', 'd1.map-events') }, 'map-tests')).toBe('done');
    expect(statusOf({ ...open, entries: { ...pass('d1.pmtiles-file', 'd1.net-state'), 'd1.map-events': { outcome: 'fail' } } }, 'map-tests')).toBe('fail');
    expect(statusOf({ ...open, entries: pass('d1.pmtiles-file') }, 'map-tests')).toBe('todo');
  });

  it('keeps the questions locked while the network is on', () => {
    const online = { ...base, online: true, mapOpened: true };
    expect(statusOf(online, 'questions')).toBe('locked');
    expect(blockerOf(online, 'questions')).toBe("Önce uçak modunu aç ve Wi-Fi'ı kapat");
  });

  it('shows answered questions as done even when the network came back', () => {
    const back = { ...base, online: true, mapOpened: true, entries: pass('d1.map-offline', 'd1.map-dark') };
    expect(statusOf(back, 'questions')).toBe('done');
  });

  it('opens the questions after the map was opened and finishes when all are answered', () => {
    expect(statusOf({ ...base, online: false }, 'questions')).toBe('locked');
    expect(blockerOf({ ...base, online: false }, 'questions')).toBe('Önce Harita sekmesini aç');
    const open = { ...base, online: false, mapOpened: true };
    expect(statusOf(open, 'questions')).toBe('todo');
    expect(statusOf({ ...open, entries: pass('d1.map-offline') }, 'questions')).toBe('todo');
    expect(statusOf({ ...open, entries: pass('d1.map-offline', 'd1.map-dark') }, 'questions')).toBe('done');
    expect(statusOf({ ...open, entries: { 'd1.map-offline': { outcome: 'fail' }, 'd1.map-dark': { outcome: 'pass' } } }, 'questions')).toBe('done');
  });

  it('unlocks the report once the online tests are done', () => {
    expect(statusOf(base, 'report')).toBe('locked');
    expect(blockerOf(base, 'report')).toBe('Önce internetli testleri bitir');
    expect(statusOf({ ...base, entries: pass('env.pack-server', 'd4.resume-download') }, 'report')).toBe('todo');
  });

  it('lets the report be copied when an online test failed', () => {
    const failed = { ...base, entries: { 'env.pack-server': { outcome: 'pass' as const }, 'd4.resume-download': { outcome: 'fail' as const } } };
    expect(statusOf(failed, 'report')).toBe('todo');
  });

  it('never calls the report step done, so it stays available for the final copy', () => {
    const all = { ...base, online: false, mapOpened: true, entries: pass('env.pack-server', 'd4.resume-download', 'd1.pmtiles-file', 'd1.net-state', 'd1.map-events', 'd1.map-offline', 'd1.map-dark') };
    expect(statusOf(all, 'report')).toBe('todo');
  });
});
