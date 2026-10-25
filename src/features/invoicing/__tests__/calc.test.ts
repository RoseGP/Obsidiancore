/**
 * Calculation engine tests. Run: npx tsx src/features/invoicing/__tests__/calc.test.ts
 */
import assert from 'node:assert/strict';
import { calculateInvoice, calculateInstallments } from '../domain/calc';
import { allocate, divRoundHalfUp, formatMoney, minorToDecimalString, parseScaled, toMinor } from '../domain/money';
import { deriveStatus } from '../domain/status';
import { validateInvoice, validatePayment } from '../domain/validation';
import { createInvoice } from '../domain/factories';
import { MOCK_SETTINGS } from '../data/mockData';
import type { LineItem, Payment } from '../domain/types';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('  ✓', name); };
const item = (q: string, p: string, t = '0', id = Math.random().toString()): LineItem => ({ id, name: 'x', description: '', quantity: q, unitPrice: p, taxRate: t });
const pay = (amount: string, status: Payment['status'] = 'confirmed'): Payment => ({
  id: 'p', receiptNumber: 'r', invoiceId: 'i', amount, currency: 'USD', date: '2026-01-01', method: 'cash',
  reference: '', note: '', status, source: 'manual', recordedBy: 'x', createdAt: '',
});

console.log('money');
test('parses decimals without floats', () => {
  assert.equal(parseScaled('0.1', 2), 10n);
  assert.equal(parseScaled('12.345', 2), null, 'refuses extra precision');
  assert.equal(parseScaled('abc', 2), null);
  assert.equal(toMinor('1000', 'JPY'), 1000n);
  assert.equal(toMinor('10.5', 'JPY'), null);
});
test('rounds half up', () => {
  assert.equal(divRoundHalfUp(5n, 10n), 1n);
  assert.equal(divRoundHalfUp(4n, 10n), 0n);
  assert.equal(divRoundHalfUp(-5n, 10n), -1n);
});
test('allocation sums exactly', () => {
  const parts = allocate(100n, [1n, 1n, 1n]);
  assert.deepEqual(parts, [34n, 33n, 33n]);
  assert.equal(parts.reduce((a, b) => a + b), 100n);
});
test('formats currency', () => {
  assert.equal(formatMoney(123456n, 'USD'), '$1,234.56');
  assert.equal(minorToDecimalString(5n, 'USD'), '0.05');
});

console.log('invoice totals');
test('0.1 + 0.2 style sums are exact', () => {
  const t = calculateInvoice({ currency: 'USD', items: [item('1', '0.10'), item('1', '0.20')], discount: { type: 'percent', value: '' }, fees: [] });
  assert.equal(t.total, 30n);
});
test('line subtotal rounds once per line', () => {
  // 3 × 3.333 h × $19.99 → 1.5 qty precision
  const t = calculateInvoice({ currency: 'USD', items: [item('1.333', '19.99')], discount: { type: 'percent', value: '' }, fees: [] });
  assert.equal(t.subtotal, 2665n); // 26.64667 → 26.65
});
test('tax per line on discounted base, discount before tax', () => {
  const t = calculateInvoice({
    currency: 'USD',
    items: [item('1', '100.00', '10'), item('1', '50.00', '0')],
    discount: { type: 'percent', value: '10' }, fees: [{ id: 'f', label: 'Shipping', amount: '5.00' }],
  });
  assert.equal(t.subtotal, 15000n);
  assert.equal(t.discount, 1500n);
  assert.equal(t.lines[0].discountShare, 1000n);
  assert.equal(t.lines[0].tax, 900n); // 10% of 90
  assert.equal(t.tax, 900n);
  assert.equal(t.total, 15000n - 1500n + 900n + 500n);
});
test('fixed discount capped at subtotal', () => {
  const t = calculateInvoice({ currency: 'USD', items: [item('1', '20')], discount: { type: 'fixed', value: '50' }, fees: [] });
  assert.equal(t.discount, 2000n);
  assert.equal(t.discountCapped, true);
  assert.equal(t.total, 0n);
});
test('8.625% tax rounds half up', () => {
  const t = calculateInvoice({ currency: 'USD', items: [item('1', '10.00', '8.625')], discount: { type: 'percent', value: '' }, fees: [] });
  assert.equal(t.tax, 86n); // 86.25 → 86
  const t2 = calculateInvoice({ currency: 'USD', items: [item('1', '2.00', '8.625')], discount: { type: 'percent', value: '' }, fees: [] });
  assert.equal(t2.tax, 17n); // 17.25 → 17
});
test('only confirmed payments reduce balance', () => {
  const input = { currency: 'USD', items: [item('1', '100')], discount: { type: 'percent' as const, value: '' }, fees: [] };
  const t = calculateInvoice(input, [pay('40.00'), pay('30.00', 'pending'), pay('10.00', 'failed')]);
  assert.equal(t.amountPaid, 4000n);
  assert.equal(t.pendingPayments, 3000n);
  assert.equal(t.balanceDue, 6000n);
});
test('installments sum to total', () => {
  const parts = calculateInstallments(10001n, [
    { id: 'a', label: 'a', percent: '33.333', dueDate: '' },
    { id: 'b', label: 'b', percent: '33.333', dueDate: '' },
    { id: 'c', label: 'c', percent: '33.334', dueDate: '' },
  ]);
  assert.equal(parts.reduce((a, p) => a + p.amount, 0n), 10001n);
});

console.log('status');
const inv = createInvoice(MOCK_SETTINGS, []);
inv.items = [item('1', '100')];
inv.dueDate = '2026-01-10';
const tot = (p: Payment[] = []) => calculateInvoice(inv, p);
test('draft stays draft even when past due', () => assert.equal(deriveStatus({ ...inv, lifecycle: 'draft' }, tot(), '2026-02-01'), 'draft'));
test('sent past due with balance is overdue', () => assert.equal(deriveStatus({ ...inv, lifecycle: 'sent' }, tot(), '2026-02-01'), 'overdue'));
test('partial past due is overdue', () => assert.equal(deriveStatus({ ...inv, lifecycle: 'sent' }, tot([pay('10')]), '2026-02-01'), 'overdue'));
test('partial before due is partially paid', () => assert.equal(deriveStatus({ ...inv, lifecycle: 'sent' }, tot([pay('10')]), '2026-01-05'), 'partially_paid'));
test('fully paid past due is paid', () => assert.equal(deriveStatus({ ...inv, lifecycle: 'sent' }, tot([pay('100')]), '2026-02-01'), 'paid'));
test('sending alone never means paid', () => assert.equal(deriveStatus({ ...inv, lifecycle: 'sent' }, tot(), '2026-01-05'), 'sent'));
test('void wins', () => assert.equal(deriveStatus({ ...inv, lifecycle: 'void' }, tot(), '2026-02-01'), 'void'));

console.log('validation');
test('duplicate invoice number rejected', () => {
  const e = validateInvoice(inv, { takenNumbers: [inv.number.toLowerCase()], mode: 'draft' });
  assert.ok(e.number);
});
test('send mode requires client email and address', () => {
  const e = validateInvoice(inv, { takenNumbers: [], mode: 'send' });
  assert.ok(e['billTo.email'] && e['billTo.address.line1']);
});
test('due before issue rejected', () => {
  const e = validateInvoice({ ...inv, issueDate: '2026-02-01', dueDate: '2026-01-01' }, { takenNumbers: [], mode: 'draft' });
  assert.ok(e.dueDate);
});
test('zero quantity rejected', () => {
  const e = validateInvoice({ ...inv, items: [item('0', '10', '0', 'z')] }, { takenNumbers: [], mode: 'draft' });
  assert.ok(e['items.z.quantity']);
});
test('payment over balance rejected', () => {
  const e = validatePayment({ amount: '101', date: '2026-01-05', method: 'cash', currency: 'USD' }, { balanceDue: 10000n, issueDate: '2026-01-01', today: '2026-01-06' });
  assert.ok(e.amount);
});

console.log(`\n${passed} passed`);
