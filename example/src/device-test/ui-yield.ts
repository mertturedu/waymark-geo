import { makeYielder } from '../../../scripts/spikes/yielder';

export const nextTurn = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const uiYielder = (everyMs = 40) => makeYielder({ now: Date.now, wait: nextTurn, everyMs });
