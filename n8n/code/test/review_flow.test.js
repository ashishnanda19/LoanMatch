// Tests for assign_provider.js, collect_review_rows.js and read_review_request.js.
// Run: node --test n8n/code/test/review_flow.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const wrap = (arr) => arr.map((j, i) => ({ json: j, pairedItem: { item: i } }));
const exec = (file, inputs) =>
  new Function('$input', '$', 'URL', `"use strict"; ${src(file)}`)(
    { all: () => wrap(inputs), first: () => wrap(inputs)[0] }, () => ({}), undefined).map((r) => r.json);

test('providers are split one third Groq, two thirds Gemini', () => {
  const out = exec('assign_provider.js', Array.from({ length: 9 }, (_, i) => ({ product_id: i })));
  assert.strictEqual(out.filter((o) => o.provider === 'groq').length, 3);
  assert.strictEqual(out.filter((o) => o.provider === 'gemini').length, 6);
  assert.strictEqual(out[0].provider, 'groq');
});

test('rows to save: only valid segments, tagged with the provider that answered', () => {
  const [o] = exec('collect_review_rows.js', [
    { product_id: 1, criteria_hash: 'a', extraction_status: 'llm_groq',
      reviews: [{ employment_type: 'Salaried', valid: true, verdict: 'eligible', caveat: null }, { employment_type: 'Business', valid: true, verdict: 'conditional', caveat: 'x' }] },
    { product_id: 2, criteria_hash: 'b', extraction_status: 'invalid_gemini',
      reviews: [{ employment_type: 'Salaried', valid: true, verdict: 'eligible', caveat: null }, { employment_type: 'Business', valid: false }] },
  ]);
  const rows = JSON.parse(o.rows_json);
  assert.strictEqual(rows.length, 3, 'the invalid segment is left out');
  assert.deepStrictEqual(rows.find((r) => r.product_id === 2), { product_id: 2, employment_type: 'Salaried', criteria_hash: 'b', verdict: 'eligible', caveat: null, provider: 'llm_gemini' });
  assert.strictEqual(rows.find((r) => r.product_id === 1 && r.employment_type === 'Business').provider, 'llm_groq');
});

test('rows to save: a later valid answer for the same segment replaces the earlier one', () => {
  const [o] = exec('collect_review_rows.js', [
    { product_id: 1, criteria_hash: 'a', extraction_status: 'llm_groq', reviews: [{ employment_type: 'Salaried', valid: true, verdict: 'eligible', caveat: null }] },
    { product_id: 1, criteria_hash: 'a', extraction_status: 'llm_gemini', reviews: [{ employment_type: 'Salaried', valid: true, verdict: 'conditional', caveat: 'y' }] },
  ]);
  assert.strictEqual(JSON.parse(o.rows_json).length, 1);
});

test('request scope: used needs a valid batch id, everything else means all', () => {
  const id = '65630588-1c90-4229-9b2c-b15a06bc94b2';
  assert.deepStrictEqual(exec('read_review_request.js', [{ scope: 'used', batch_id: id }])[0], { scope: 'used', batch_id: id });
  assert.deepStrictEqual(exec('read_review_request.js', [{ body: { scope: 'used', batch_id: id } }])[0], { scope: 'used', batch_id: id });
  assert.strictEqual(exec('read_review_request.js', [{ scope: 'used' }])[0].scope, 'all', 'no batch => all');
  assert.strictEqual(exec('read_review_request.js', [{ upserted_products: 40 }])[0].scope, 'all', 'crawl summary => all');
  assert.strictEqual(exec('read_review_request.js', [{ scope: 'used', batch_id: "x'; DROP TABLE users;--" }])[0].batch_id, '');
});
