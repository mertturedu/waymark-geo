import fc from 'fast-check';
import { formatLabel } from '../../src/core/address/label';
import type { Place } from '../../src/core/address/types';
import { createLearning, type ConfirmInput } from '../../src/core/learn/learning';
import { memoryStore } from '../../src/core/learn/store';
import { ALLOWED_CONFIRMATION_FIELDS, ALLOWED_FIELDS } from '../../src/core/learn/types';

const components = { province: 'İstanbul', district: 'Kadıköy', neighbourhood: 'Moda', street: 'Gül Sokak', houseNumber: '20' };
const place = (label: string): Place => ({ id: 'x', label, components, coordinate: [28.66, 40.76], precision: 'interpolated', approximate: true, source: 'interpolated', confidence: 0.5, region: '34' });

describe('K4.9 a record carries only the allowed fields', () => {
  it('whatever else the caller hangs on the input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.dictionary(fc.constantFrom('name', 'phone', 'orderId', 'note', 'email', 'customer', 'courierId', 'address', 'tc'), fc.string({ minLength: 3, maxLength: 20 }).map((s) => `ZZ${s}`)),
        fc.string({ minLength: 3, maxLength: 20 }).map((s) => `QQ${s}`),
        fc.constantFrom('pin', 'delivery', 'manual'),
        async (extra, label, source) => {
          const store = memoryStore();
          const learning = await createLearning({ store, now: () => 1_700_000_000 });
          const input = { ...extra, place: { ...place(label), ...extra }, point: [28.66, 40.76], source, accuracyM: 8 } as unknown as ConfirmInput;
          expect(await learning.confirm(input)).toMatchObject({ ok: true });
          const all = [...store.snapshot().values(), ...learning.exportLines()];
          for (const text of all) {
            const record = JSON.parse(text) as Record<string, unknown>;
            expect(Object.keys(record).every((k) => ALLOWED_FIELDS.includes(k))).toBe(true);
            for (const c of record.confirmations as Record<string, unknown>[]) expect(Object.keys(c).every((k) => ALLOWED_CONFIRMATION_FIELDS.includes(k))).toBe(true);
            expect(record.text).toBe(formatLabel(components, 'tr'));
            for (const secret of [...Object.values(extra), label]) expect(text).not.toContain(secret);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
