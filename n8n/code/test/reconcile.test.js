// Tests for reconcile_products.js. Run: node --test n8n/code/test/reconcile.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'reconcile_products.js'), 'utf8');

function run(products) {
  const items = products.map((p, i) => ({ json: { product_id: i + 1, interest_rate: 10, eligibility_rules: [], ...p } }));
  const fn = new Function('$input', 'console', 'URL', `"use strict"; ${SRC}`);
  return fn({ all: () => items }, { log() {} }, undefined).map((r) => r.json);
}

test('same lender on several sites collapses to one record', () => {
  const out = run([
    { source_site: 'paisabazaar', product_name: 'HDFC Bank Personal Loan' },
    { source_site: 'bankbazaar', product_name: 'HDFC Personal Loan' },
  ]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].products_in_group, 2);
});

test('similar-looking but different lenders are NOT merged', () => {
  const out = run([
    { source_site: 'paisabazaar', product_name: 'Bank of India Personal Loan' },
    { source_site: 'paisabazaar', product_name: 'Indian Bank Personal Loan' },
    { source_site: 'paisabazaar', product_name: 'Bank of Baroda Personal Loan' },
    { source_site: 'paisabazaar', product_name: 'Union Bank Personal Loan' },
    { source_site: 'bankbazaar', product_name: 'Union Bank of India Personal Loan' },
    { source_site: 'paisabazaar', product_name: 'IDFC FIRST Bank Personal Loan' },
    { source_site: 'bankbazaar', product_name: 'IDFC First Personal Loan' },
    { source_site: 'paisabazaar', product_name: 'HDBFS Personal Loan' },
    { source_site: 'paisabazaar', product_name: 'HDFC Bank Personal Loan' },
  ]);
  // BoI, Indian, Baroda, Union(x2 merged), IDFC(x2 merged), HDBFS, HDFC  => 7
  assert.strictEqual(out.length, 7);
});

test('the lender\'s own site beats aggregators, even with less detail', () => {
  const [o] = run([
    { source_site: 'paisabazaar', product_name: 'Bajaj Finance Personal Loan', min_income: 30000, min_credit_score: 685, min_age: 21, max_age: 60 },
    { source_site: 'bajajfinserv', product_name: 'Bajaj Finance Personal Loan', min_credit_score: 650 },
  ]);
  assert.strictEqual(o.source_site, 'bajajfinserv');
  assert.strictEqual(o.min_credit_score, 650);
});

test('otherwise the record stating more criteria wins; ties go to Paisabazaar', () => {
  const [a] = run([
    { source_site: 'paisabazaar', product_name: 'Kotak Mahindra Personal Loan' },
    { source_site: 'bankbazaar', product_name: 'Kotak Mahindra Personal Loan', min_income: 20000, min_age: 21 },
  ]);
  assert.strictEqual(a.source_site, 'bankbazaar');
  const [b] = run([
    { source_site: 'bankbazaar', product_name: 'SBI Personal Loan', min_income: 15000 },
    { source_site: 'paisabazaar', product_name: 'SBI Bank Personal Loan', min_income: 20000 },
  ]);
  assert.strictEqual(b.source_site, 'paisabazaar');
});

test('the rate used is the lowest published across sources, while rules come from the authoritative record', () => {
  const [a] = run([
    { source_site: 'paisabazaar', product_name: 'Axis Bank Personal Loan', interest_rate: 9.99, min_income: 15000, min_age: 21 },
    { source_site: 'bankbazaar', product_name: 'Axis Bank Personal Loan', interest_rate: 8.75 },
  ]);
  assert.strictEqual(a.source_site, 'paisabazaar', 'rules still come from the record with more criteria');
  assert.strictEqual(a.min_income, 15000);
  assert.strictEqual(a.effective_rate, 8.75);
  assert.strictEqual(a.rates_seen.length, 2);
});

test('missing rates are ignored; no rate anywhere gives null', () => {
  const [a] = run([
    { source_site: 'paisabazaar', product_name: 'Foo Personal Loan', interest_rate: null },
    { source_site: 'bankbazaar', product_name: 'Foo Personal Loan', interest_rate: 11.5 },
  ]);
  assert.strictEqual(a.effective_rate, 11.5);
  const [b] = run([{ source_site: 'paisabazaar', product_name: 'Bar Personal Loan', interest_rate: null }]);
  assert.strictEqual(b.effective_rate, null);
});
