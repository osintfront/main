// Run: node --experimental-strip-types --test tests/billing/billing.test.ts
//
// Example tests for the billing helpers, using made-up events (not Grow's format).
// They check prices, the checks before billing_apply, and the argument names the RPC expects.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callerIp,
  GROW_IPS,
  readGrowNotice,
  validFullName,
  validPhone,
  parseWebhookBody,
  priceAgorot,
  SERVER_PRICES,
  stripCardFields,
  toBillingApplyArgs,
  tokenMatches,
  type VerifiedPayment,
} from '../../api/_lib/billing.ts';
import { INTRO_PRICES } from '../../src/content/packages.ts';

const user = '00000000-0000-4000-8000-000000000001';

test('prices come from the packages table, in agorot', () => {
  assert.equal(priceAgorot('pro', 'monthly'), 5900);
  assert.equal(priceAgorot('pro', 'yearly'), 59000);
  assert.equal(priceAgorot('max', 'monthly'), 12900);
  assert.equal(priceAgorot('max', 'yearly'), 129000);
});

test('a monthly Pro payment maps to billing_apply arguments', () => {
  const event: VerifiedPayment = {
    eventKey: 'example-evt-1',
    kind: 'payment',
    userId: user,
    plan: 'pro',
    period: 'monthly',
    growSubscriptionId: 'example-sub-1',
    transactionId: 'example-txn-1',
    amountAgorot: 5900,
    vatAgorot: 900,
  };
  assert.deepEqual(toBillingApplyArgs(event), {
    p_event_key: 'example-evt-1',
    p_kind: 'payment',
    p_user: user,
    p_plan: 'pro',
    p_period: 'monthly',
    p_grow_subscription_id: 'example-sub-1',
    p_transaction_id: 'example-txn-1',
    p_order_id: null,
    p_amount_agorot: 5900,
    p_vat_agorot: 900,
  });
});

test('an amount that does not match the price is refused before the database', () => {
  const event: VerifiedPayment = {
    eventKey: 'example-evt-2', kind: 'payment', userId: user,
    plan: 'max', period: 'yearly', transactionId: 'example-txn-2', amountAgorot: 5900,
  };
  assert.throws(() => toBillingApplyArgs(event), /amount mismatch/);
});

test('a payment without a transaction id is refused', () => {
  const event: VerifiedPayment = {
    eventKey: 'example-evt-3', kind: 'renewal', userId: user,
    plan: 'pro', period: 'monthly', amountAgorot: 5900,
  };
  assert.throws(() => toBillingApplyArgs(event), /transaction id required/);
});

test('an unknown plan or period is refused', () => {
  const badPlan = { eventKey: 'example-evt-4', kind: 'payment', userId: user, plan: 'intel', period: 'monthly', transactionId: 't', amountAgorot: 5900 } as unknown as VerifiedPayment;
  const badPeriod = { eventKey: 'example-evt-5', kind: 'payment', userId: user, plan: 'pro', period: 'weekly', transactionId: 't', amountAgorot: 5900 } as unknown as VerifiedPayment;
  assert.throws(() => toBillingApplyArgs(badPlan), /unknown plan/);
  assert.throws(() => toBillingApplyArgs(badPeriod), /unknown period/);
});

test('a missing event key or user is refused', () => {
  assert.throws(() => toBillingApplyArgs({ eventKey: ' ', kind: 'canceled', userId: user }), /event key required/);
  assert.throws(() => toBillingApplyArgs({ eventKey: 'example-evt-6', kind: 'canceled', userId: '' }), /user required/);
});

test('a refund needs no plan and maps the amount as given', () => {
  const args = toBillingApplyArgs({
    eventKey: 'example-evt-7', kind: 'refund', userId: user, transactionId: 'example-refund-1', amountAgorot: 5900,
  });
  assert.equal(args.p_kind, 'refund');
  assert.equal(args.p_plan, null);
  assert.equal(args.p_amount_agorot, 5900);
});

test('server prices match the prices on the packages page', () => {
  for (const plan of ['pro', 'max'] as const) {
    assert.equal(SERVER_PRICES[plan].monthly, INTRO_PRICES[plan].monthly, `${plan} monthly`);
    assert.equal(SERVER_PRICES[plan].yearly, INTRO_PRICES[plan].yearly, `${plan} yearly`);
  }
});

test('the webhook token must match exactly, and an empty secret never matches', () => {
  assert.equal(tokenMatches('s3cret-value', 's3cret-value'), true);
  assert.equal(tokenMatches('s3cret-valuX', 's3cret-value'), false);
  assert.equal(tokenMatches('short', 's3cret-value'), false);
  assert.equal(tokenMatches(null, 's3cret-value'), false);
  assert.equal(tokenMatches('', ''), false);
  assert.equal(tokenMatches('anything', ''), false);
});

test('notification bodies are read as JSON, form fields or raw text', () => {
  assert.deepEqual(parseWebhookBody('application/json', '{"status":"1","sum":"1"}'), { status: '1', sum: '1' });
  assert.deepEqual(
    parseWebhookBody('application/x-www-form-urlencoded; charset=UTF-8', 'status=1&sum=1&data%5Bemail%5D=a%40b.c'),
    { status: '1', sum: '1', 'data[email]': 'a@b.c' },
  );
  assert.deepEqual(parseWebhookBody('text/plain', 'hello'), { raw: 'hello' });
  assert.deepEqual(parseWebhookBody('application/json', '{not json'), { raw: '{not json' });
  assert.deepEqual(parseWebhookBody('application/json', '[1,2]'), { value: [1, 2] });
});

test('card-like fields are removed at any depth, other fields are kept', () => {
  const example = {
    sum: '1',
    fullName: 'Example Payer',
    cardSuffix: '1234',
    data: { cardExp: '12/30', cvv: '000', transactionId: 'example-txn', items: [{ creditCardNumber: 'x', name: 'Test' }] },
    exp_month: '12',
  };
  assert.deepEqual(stripCardFields(example), {
    sum: '1',
    fullName: 'Example Payer',
    data: { transactionId: 'example-txn', items: [{ name: 'Test' }] },
  });
});

// ── Grow notifications (formats from developers.grow.business → Webhooks / Server-to-Server Callback) ──

const orderId = '7d5f0a3e-1b2c-4d5e-8f90-123456789abc';

test('a paid payment link (JSON) is read as a payment, products do not override the sum', () => {
  const n = readGrowNotice({
    err: '',
    status: '1',
    data: {
      status: 'שולם', statusCode: '2', sum: '59', transactionId: '421100', transactionToken: 'tok', asmachta: '117128222',
      payerPhone: ' 0501111111', payerEmail: 'a@b.co', paymentLinkProcessId: '12128', processId: ' 512895',
      productData: [{ name: 'Pro', price: '1', sum: '1' }], customFields: { cField1: orderId },
    },
  });
  assert.equal(n.type, 'payment');
  if (n.type !== 'payment') return;
  assert.equal(n.paid, true);
  assert.equal(n.amountAgorot, 5900);
  assert.equal(n.processId, '12128');
  assert.equal(n.orderId, orderId);
  assert.equal(n.eventKey, 'pay:421100');
});

test('the same notification posted as form fields reads the same', () => {
  const form = new URLSearchParams({
    status: '1', err: '', 'data[statusCode]': '2', 'data[sum]': '129', 'data[transactionId]': '99',
    'data[paymentLinkProcessId]': '555', 'data[productData][0][sum]': '1', 'data[customFields][cField1]': orderId,
  }).toString();
  const n = readGrowNotice(parseWebhookBody('application/x-www-form-urlencoded', form));
  assert.equal(n.type, 'payment');
  if (n.type !== 'payment') return;
  assert.equal(n.amountAgorot, 12900);
  assert.equal(n.orderId, orderId);
  assert.equal(n.processId, '555');
});

test('a real first monthly payment (form fields, as Grow sent it) carries the standing-order id', () => {
  const form = new URLSearchParams({
    err: '', status: '1', 'data[sum]': '1', 'data[status]': 'שולם', 'data[statusCode]': '2', 'data[asmachta]': '533278517',
    'data[processId]': '37494911', 'data[paymentType]': '1', 'data[directDebitId]': '55556463', 'data[transactionId]': '89430984',
    'data[paymentLinkProcessId]': '4291822', 'data[payerPhone]': '0500000000',
  }).toString();
  const n = readGrowNotice(parseWebhookBody('application/x-www-form-urlencoded', form));
  assert.equal(n.type, 'payment');
  if (n.type !== 'payment') return;
  assert.equal(n.paid, true);
  assert.equal(n.amountAgorot, 100);
  assert.equal(n.processId, '4291822');
  assert.equal(n.directDebitId, '55556463');
});

test('a declined payment is not paid', () => {
  const n = readGrowNotice({ status: '1', data: { statusCode: '3', status: 'נדחה', sum: '59', transactionId: '1', paymentLinkProcessId: '2' } });
  assert.equal(n.type === 'payment' && n.paid, false);
});

test('a monthly renewal (second charge on) is read with its standing-order id', () => {
  const n = readGrowNotice({
    webhookKey: 'ABC', transactionCode: 'ABCD1234', paymentSum: 59, paymentType: 'הוראת קבע',
    payerPhone: '0500000000', payerEmail: 'test@test.com', paymentSource: 'ריצת הוראת קבע', directDebitId: '123456',
  });
  assert.deepEqual(n, {
    type: 'renewal', eventKey: 'ren:ABCD1234', directDebitId: '123456', transactionId: 'ABCD1234',
    amountAgorot: 5900, phone: '0500000000', email: 'test@test.com',
  });
});

test('a failed monthly charge is read as failed', () => {
  const n = readGrowNotice({
    regular_payment_id: '55545', payer_name: 'Full Name', phone: '0500000000', email: 'test@test.com',
    transaction_type: 'הוראת קבע', sum: '59', error_message: 'פג תוקף', charges_attempts: '6', webhook_key: 'x',
  });
  assert.equal(n.type, 'failed');
  if (n.type !== 'failed') return;
  assert.equal(n.directDebitId, '55545');
  assert.equal(n.attempts, 6);
  assert.equal(n.amountAgorot, 5900);
  assert.equal(n.error, 'פג תוקף');
});

test('an invoice notification is not a payment', () => {
  assert.equal(readGrowNotice({ transactionCode: 'ABCD1234', invoiceNumber: '20', invoiceUrl: 'https://x' }).type, 'unknown');
});

test('checkout input: names and Israeli mobile numbers', () => {
  assert.equal(validFullName('ישראל ישראלי'), 'ישראל ישראלי');
  assert.equal(validFullName('Dana'), null);
  assert.equal(validFullName('A Bc'), null);
  assert.equal(validPhone('050-123-4567'), '0501234567');
  assert.equal(validPhone('+972 50 123 4567'), '0501234567');
  assert.equal(validPhone('031234567'), null);
});

test('Grow servers are recognised by address', () => {
  assert.ok(GROW_IPS.has('3.123.194.128'));
  assert.equal(GROW_IPS.has('1.2.3.4'), false);
  assert.equal(callerIp(new Headers({ 'x-forwarded-for': '3.70.40.72, 10.0.0.1' })), '3.70.40.72');
});

test('a negative refund amount is refused', () => {
  assert.throws(
    () => toBillingApplyArgs({ eventKey: 'example-evt-8', kind: 'refund', userId: user, amountAgorot: -1 }),
    /must not be negative/,
  );
});
