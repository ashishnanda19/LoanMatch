// Tests for build_email.js, record_outcome.js and normalize_trigger.js.
// Run: node --test n8n/code/test/notify.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const wrap = (arr) => arr.map((j, i) => ({ json: j, pairedItem: { item: i } }));
const exec = (file, inputs, lookup) =>
  new Function('$input', '$', 'URL', `"use strict"; ${src(file)}`)(
    { all: () => wrap(inputs), first: () => wrap(inputs)[0] }, lookup || (() => ({})), undefined).map((r) => r.json);

const user = (over = {}) => ({
  user_id: 'u1', name: 'Saanvi Shaikh', credit_score: 670, recipient_email: 'me+one@gmail.com', sender_email: 'me@gmail.com',
  products: [
    { match_id: 11, rank: 1, product: 'Bajaj Finance Personal Loan', rate: '10.99', verdict: 'conditional', caveat: 'Needs 2 years of work history.' },
    { match_id: 12, rank: 2, product: 'HDFC Bank Personal Loan', rate: 10.5, verdict: 'eligible', caveat: null },
    { match_id: 13, rank: 3, product: 'Mystery Lender', rate: null, verdict: null, caveat: null },
  ], ...over,
});

test('one email per user with real product names, rates and ids', () => {
  const [m] = exec('build_email.js', [user()]);
  assert.strictEqual(m.to, 'me+one@gmail.com');
  assert.strictEqual(m.from, 'me@gmail.com');
  assert.strictEqual(m.subject, 'Saanvi, your 3 best personal loan matches');
  assert.deepStrictEqual(m.match_ids, [11, 12, 13]);
  for (const s of ['Bajaj Finance Personal Loan', 'From 10.99% p.a.', 'From 10.50% p.a.', 'Rate on request',
    'Needs 2 years of work history.', 'No extra conditions found']) assert.ok(m.html.includes(s), s);
});

test('names and caveats from the CSV or the web are HTML-escaped', () => {
  const [m] = exec('build_email.js', [user({
    name: '<script>alert(1)</script> Bob',
    products: [{ match_id: 1, rank: 1, product: 'A & B <b>Bank</b>', rate: 9, caveat: '<img src=x onerror=1>' }],
  })]);
  assert.ok(!m.html.includes('<script>') && !m.html.includes('<img') && !m.html.includes('<b>Bank'));
  assert.ok(m.html.includes('A &amp; B &lt;b&gt;Bank'));
});

test('a newline in the name cannot inject mail headers into the subject', () => {
  const [m] = exec('build_email.js', [user({ name: 'Eve\r\nBcc: attacker@evil.test' })]);
  assert.ok(!/[\r\n]/.test(m.subject));
});

test('singular wording and empty name fallback', () => {
  const [m] = exec('build_email.js', [user({ name: '  ', products: [user().products[0]] })]);
  assert.strictEqual(m.subject, 'there, your 1 best personal loan match');
});

test('record_outcome pairs results with emails and flags failures', () => {
  const mails = [{ user_id: 'a', to: 'x', match_ids: [1, 2] }, { user_id: 'b', to: 'y', match_ids: [3] }, { user_id: 'c', to: 'z', match_ids: [4] }];
  const out = exec('record_outcome.js',
    [{ SendEmailResponse: { SendEmailResult: { MessageId: 'm-1' } } }, { error: { message: 'MessageRejected: not verified' } }, {}],
    () => ({ itemMatching: (i) => wrap(mails)[i] }));
  assert.deepStrictEqual(out.map((o) => o.sent), [true, false, false]);
  assert.strictEqual(out[0].message_id, 'm-1');
  assert.strictEqual(out[0].match_ids_json, '[1,2]');
  assert.match(out[1].error, /MessageRejected/);
});

test('trigger input: batch id from workflow B, from a webhook body, or empty', () => {
  const id = '65630588-1c90-4229-9b2c-b15a06bc94b2';
  assert.strictEqual(exec('normalize_trigger.js', [{ batch_id: id }])[0].batch_id, id);
  assert.strictEqual(exec('normalize_trigger.js', [{ body: { batch_id: id } }])[0].batch_id, id);
  assert.strictEqual(exec('normalize_trigger.js', [{}])[0].batch_id, '');
  assert.strictEqual(exec('normalize_trigger.js', [{ batch_id: "x'; DROP TABLE users;--" }])[0].batch_id, '', 'junk is discarded');
});

test('record_outcome also accepts a flat MessageId', () => {
  const out = exec('record_outcome.js', [{ MessageId: 'flat-1' }], () => ({ itemMatching: () => ({ json: { user_id: 'a', to: 'x', match_ids: [1] } }) }));
  assert.strictEqual(out[0].sent, true);
  assert.strictEqual(out[0].message_id, 'flat-1');
});

const withProduct = (p) => exec('build_email.js', [user({ products: [{ match_id: 1, rank: 1, product: 'X Bank', rate: 9, ...p }] })])[0].html;

test('credit score: shown at the top, and each row compares it with the lender minimum', () => {
  const html = exec('build_email.js', [user()])[0].html;
  assert.ok(html.includes('your credit score: 670'));
  assert.ok(html.includes('<th style="padding:10px">Credit score</th>'));
});

test('credit score: flagged when the lender states a higher minimum only for other applicants', () => {
  const html = withProduct({ score_flag: true, floor_own: null, floor_any: 700 });
  assert.ok(html.includes('Check:') && html.includes('your score is 670') && html.includes('700 is required for other applicants'));
});

test('credit score: met, not stated, and not published wordings', () => {
  assert.ok(withProduct({ floor_own: 650, floor_any: 650 }).includes('Your 670 meets the 650 minimum'));
  assert.ok(withProduct({ floor_own: null, floor_any: 600 }).includes('Minimum not stated for you; your 670 is above the 600 others need'));
  assert.ok(withProduct({ floor_own: null, floor_any: null }).includes('Lender does not publish a minimum (your score: 670)'));
});
