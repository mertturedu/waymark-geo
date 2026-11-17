import fc from 'fast-check';
import { EVENTS, STATES, TRANSITIONS, step, type RegionEvent, type RegionState } from '../../src/core/packs/machine';

describe('region state machine', () => {
  const allowed: [RegionState, RegionEvent, RegionState][] = [
    ['none', 'request', 'queued'],
    ['error', 'request', 'queued'],
    ['installed', 'request', 'queued'],
    ['update-available', 'request', 'queued'],
    ['paused', 'resume', 'queued'],
    ['queued', 'start', 'downloading'],
    ['queued', 'pause', 'paused'],
    ['downloading', 'pause', 'paused'],
    ['downloading', 'verify', 'verifying'],
    ['verifying', 'complete', 'installed'],
    ['queued', 'fail', 'error'],
    ['downloading', 'fail', 'error'],
    ['verifying', 'fail', 'error'],
    ['installed', 'update-found', 'update-available'],
    ['update-available', 'update-gone', 'installed'],
    ['none', 'remove', 'none'],
    ['queued', 'remove', 'none'],
    ['downloading', 'remove', 'none'],
    ['verifying', 'remove', 'none'],
    ['paused', 'remove', 'none'],
    ['installed', 'remove', 'none'],
    ['update-available', 'remove', 'none'],
    ['error', 'remove', 'none'],
    ['queued', 'restore', 'paused'],
    ['downloading', 'restore', 'paused'],
    ['verifying', 'restore', 'paused'],
  ];

  it.each(allowed)('moves %s to the next state on %s', (from, event, to) => {
    expect(step(from, event)).toEqual({ ok: true, state: to });
  });

  it('has exactly the transitions listed above and rejects everything else', () => {
    const listed = new Set(allowed.map(([from, event]) => `${from}/${event}`));
    let seen = 0;
    for (const from of STATES) {
      for (const event of EVENTS) {
        const result = step(from, event);
        if (listed.has(`${from}/${event}`)) seen += 1;
        else expect(result).toEqual({ ok: false, state: from });
      }
    }
    expect(seen).toBe(allowed.length);
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STATES].sort());
  });

  it('never leaves the known states whatever the event sequence', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...EVENTS), { maxLength: 40 }), (events) => {
        let state: RegionState = 'none';
        for (const event of events) {
          state = step(state, event).state;
          if (!STATES.includes(state)) return false;
        }
        return true;
      }),
    );
  });
});
