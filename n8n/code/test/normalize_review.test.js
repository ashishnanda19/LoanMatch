// Tests for normalize_review.js (one LLM answer = one lender, all of its employment types).
// Run: node --test n8n/code/test/normalize_review.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'normalize_review.js'), 'utf8');

function run(provider, responses, types = ['Salaried', 'Self-Employed']) {
  const originals = responses.map((_, i) => ({ product_id: i + 1, employment_types: types, criteria_hash: 'h' + i }));
  const wrap = (a) => a.map((j, i) => ({ json: j, pairedItem: { item: i } }));
  const fn = new Function('$input', '$', 'URL', `"use strict"; ${SRC.replace('__PROVIDER__', provider)}`);
  return fn({ all: () => wrap(responses) }, () => ({ itemMatching: (i) => wrap(originals)[i] }), undefined).map((r) => r.json);
}
const groq = (o) => ({ choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } }] });
const gemini = (o) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] });

test('one answer yields a validated note for every requested employment type', () => {
  const [a] = run('groq', [groq({ reviews: {
    Salaried: { verdict: 'conditional', caveat: 'Needs 2 years of work experience.' },
    'Self-Employed': { verdict: 'eligible', caveat: 'should be dropped' },
  } })]);
  assert.strictEqual(a.all_valid, true);
  assert.strictEqual(a.extraction_status, 'llm_groq');
  assert.deepStrictEqual(a.reviews.map((r) => [r.employment_type, r.verdict, r.caveat]),
    [['Salaried', 'conditional', 'Needs 2 years of work experience.'], ['Self-Employed', 'eligible', null]]);
});

test("an LLM 'ineligible' never excludes a user: it is demoted to conditional", () => {
  const [a] = run('groq', [groq({ reviews: { Salaried: { verdict: ' INELIGIBLE ', caveat: 'Only for salaried.' }, 'Self-Employed': { verdict: 'ineligible', caveat: null } } })]);
  assert.strictEqual(a.reviews[0].verdict, 'conditional');
  assert.strictEqual(a.reviews[0].demoted, true);
  assert.strictEqual(a.reviews[0].caveat, 'Only for salaried.');
  assert.ok(a.reviews[1].caveat && a.reviews[1].caveat.length > 10, 'a demoted verdict without a caveat still gets one');
});

test('type keys are matched leniently (case, spaces, hyphens)', () => {
  const [a] = run('gemini', [gemini({ reviews: { salaried: { verdict: 'eligible' }, 'self employed': { verdict: 'eligible' } } })]);
  assert.strictEqual(a.all_valid, true);
  assert.strictEqual(a.extraction_status, 'llm_gemini');
});

test('a missing type makes the lender incomplete (routes to the fallback) but keeps the valid part', () => {
  const [a] = run('groq', [groq({ reviews: { Salaried: { verdict: 'eligible' } } })]);
  assert.strictEqual(a.all_valid, false);
  assert.strictEqual(a.extraction_status, 'invalid_groq');
  assert.deepStrictEqual(a.reviews.map((r) => r.valid), [true, false]);
});

test('malformed, empty and failed responses are all invalid', () => {
  const out = run('groq', [
    groq('sorry, I cannot help'),
    groq({ reviews: {} }),
    groq({ reviews: { Salaried: { verdict: 'maybe' }, 'Self-Employed': { verdict: 'eligible' } } }),
    { error: { message: 'HTTP 429' } },
    {},
  ]);
  out.forEach((o) => { assert.strictEqual(o.all_valid, false); assert.strictEqual(o.extraction_status, 'invalid_groq'); });
});

test('tolerates code fences and prose around the JSON; long caveats are truncated', () => {
  const [a, b] = run('groq', [
    groq('```json\n{"reviews":{"Salaried":{"verdict":"eligible"},"Self-Employed":{"verdict":"eligible"}}}\n```'),
    groq('Here: {"reviews":{"Salaried":{"verdict":"conditional","caveat":"' + 'x'.repeat(300) + '"},"Self-Employed":{"verdict":"eligible"}}} ok'),
  ]);
  assert.strictEqual(a.all_valid, true);
  assert.ok(b.reviews[0].caveat.length <= 160);
});

test('original fields (prompt, ids, hash) are carried through for the fallback and the save', () => {
  const [a] = run('groq', [groq('nope')]);
  assert.strictEqual(a.product_id, 1);
  assert.strictEqual(a.criteria_hash, 'h0');
  assert.deepStrictEqual(a.employment_types, ['Salaried', 'Self-Employed']);
});
