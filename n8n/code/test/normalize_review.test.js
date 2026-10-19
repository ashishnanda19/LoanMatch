// Tests for normalize_review.js. Run: node --test n8n/code/test/normalize_review.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'normalize_review.js'), 'utf8');

function run(provider, responses) {
  const originals = responses.map((_, i) => ({ product_id: i + 1, employment_type: 'Salaried' }));
  const wrap = (a) => a.map((j, i) => ({ json: j, pairedItem: { item: i } }));
  const fn = new Function('$input', '$', 'URL', `"use strict"; ${SRC.replace('__PROVIDER__', provider)}`);
  return fn({ all: () => wrap(responses) }, () => ({ itemMatching: (i) => wrap(originals)[i] }), undefined).map((r) => r.json);
}
const groq = (o) => ({ choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } }] });
const gemini = (o) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] });

test('valid verdicts are accepted and normalised', () => {
  const [a, b, c] = run('groq', [
    groq({ verdict: 'conditional', caveat: 'Needs 2 years of work experience.' }),
    groq({ verdict: ' INELIGIBLE ', caveat: 'Only for salaried applicants.' }),
    groq({ verdict: 'eligible', caveat: 'should be dropped' }),
  ]);
  assert.strictEqual(a.valid, true);
  assert.strictEqual(a.verdict, 'conditional');
  assert.strictEqual(b.verdict, 'conditional', "an LLM 'ineligible' must never exclude a user: it is demoted");
  assert.strictEqual(b.demoted_ineligible, true);
  assert.strictEqual(b.caveat, 'Only for salaried applicants.');
  assert.strictEqual(c.caveat, null, 'eligible never carries a caveat');
});

test('unknown verdicts, junk and errors are invalid (=> Gemini fallback)', () => {
  const out = run('groq', [groq({ verdict: 'maybe' }), groq('not json'), groq({}), { error: { message: '429' } }, {}]);
  out.forEach((o) => { assert.strictEqual(o.valid, false); assert.strictEqual(o.extraction_status, 'invalid_groq'); });
});

test('long caveats are truncated; null-ish strings become null', () => {
  const [a, b] = run('groq', [
    groq({ verdict: 'conditional', caveat: 'x'.repeat(400) }),
    groq({ verdict: 'conditional', caveat: 'None' }),
  ]);
  assert.strictEqual(a.caveat.length, 160);
  assert.strictEqual(b.caveat, null);
});

test('Gemini shape and code fences', () => {
  const [a, b] = run('gemini', [
    gemini({ verdict: 'eligible', caveat: null }),
    { candidates: [{ content: { parts: [{ text: '```json\n{"verdict":"conditional","caveat":"Depends on city."}\n```' }] } }] },
  ]);
  assert.strictEqual(a.extraction_status, 'llm_gemini');
  assert.strictEqual(b.verdict, 'conditional');
});

test('a demoted ineligible without a caveat still gets one', () => {
  const [a] = run('groq', [groq({ verdict: 'ineligible', caveat: null })]);
  assert.strictEqual(a.verdict, 'conditional');
  assert.ok(a.caveat && a.caveat.length > 10);
});
