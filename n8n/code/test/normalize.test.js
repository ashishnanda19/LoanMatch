// Tests for normalize_extraction.js. Run: node --test n8n/code/test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'normalize_extraction.js'), 'utf8');

function run(provider, llmResponses, text = 'Open to salaried and self-employed applicants. Minimum CIBIL score required is 685.') {
  const originals = llmResponses.map((_, i) => ({ source_site: 's', product_name: `P${i}`, eligibility_text: text }));
  const wrap = (arr) => arr.map((j, i) => ({ json: j, pairedItem: { item: i } }));
  const $input = { all: () => wrap(llmResponses) };
  const $ = () => ({ itemMatching: (i) => wrap(originals)[i] });
  const fn = new Function('$input', '$', 'URL', `"use strict"; ${SRC.replace('__PROVIDER__', provider)}`);
  return fn($input, $, undefined).map((r) => r.json);
}

const groq = (obj) => ({ choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }] });
const gemini = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

test('ICICI-style: per-type rules, null income for self-employed forces a null envelope', () => {
  const [r] = run('groq', [groq({
    rules: [
      { employment_types: ['Salaried'], min_income: 30000, min_credit_score: null, min_age: 20, max_age: 58 },
      { employment_types: ['Self-Employed'], min_income: null, min_credit_score: null, min_age: 23, max_age: 65 },
    ],
    qualitative_criteria: '2 years experience',
  })]);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.eligibility_rules.length, 2);
  assert.strictEqual(r.min_income, null, 'envelope must stay a superset: unstated income => no floor');
  assert.strictEqual(r.min_age, 20);
  assert.strictEqual(r.max_age, 65);
  assert.deepStrictEqual(r.allowed_employment_types, ['Salaried', 'Self-Employed', 'Business']);
  assert.deepStrictEqual(r.eligibility_rules[1].employment_types, ['Self-Employed', 'Business']);
  assert.strictEqual(r.qualitative_criteria_text, '2 years experience');
});

test('duplicate rules for the same type are merged permissively (SBI-style)', () => {
  const [r] = run('groq', [groq({
    rules: [
      { employment_types: ['Salaried'], min_income: 20000, min_age: 21, max_age: 60 },
      { employment_types: ['Salaried'], min_income: 25000, min_age: 21, max_age: 60 },
    ],
    qualitative_criteria: null,
  })]);
  assert.strictEqual(r.eligibility_rules.length, 1);
  assert.strictEqual(r.eligibility_rules[0].min_income, 20000);
  assert.strictEqual(r.min_income, 20000);
});

test('identical rules for several types are regrouped into one rule (Bajaj-style)', () => {
  const [r] = run('groq', [groq({
    rules: [
      { employment_types: ['Salaried'], min_credit_score: 685, min_age: 21, max_age: 80 },
      { employment_types: ['Self-Employed'], min_credit_score: 685, min_age: 21, max_age: 80 },
      { employment_types: ['Self-Employed'], min_credit_score: 685, min_age: 22, max_age: 80 },
    ],
  })]);
  assert.strictEqual(r.eligibility_rules.length, 1);
  assert.deepStrictEqual(r.eligibility_rules[0].employment_types, ['Salaried', 'Self-Employed', 'Business']);
  assert.strictEqual(r.min_credit_score, 685);
});

test('no applicant type named => Salaried only (personal loans are employer-based unless stated)', () => {
  const [r] = run('groq', [groq({ rules: [{ employment_types: [], min_age: 21, max_age: 60 }] })]);
  assert.deepStrictEqual(r.allowed_employment_types, ['Salaried']);
});

test('implausible numbers are dropped, not stored', () => {
  const [r] = run('groq', [groq({
    rules: [{ employment_types: ['Salaried'], min_income: 5, min_credit_score: 9999, min_age: 5, max_age: 500 }],
  })]);
  assert.strictEqual(r.valid, true);
  assert.deepStrictEqual(
    [r.min_income, r.min_credit_score, r.min_age, r.max_age], [null, null, null, null]);
});

test('contradictory ages are discarded', () => {
  const [r] = run('groq', [groq({ rules: [{ employment_types: ['Salaried'], min_age: 60, max_age: 21 }] })]);
  assert.strictEqual(r.min_age, null);
  assert.strictEqual(r.max_age, null);
});

test('malformed responses are marked invalid (so the Gemini fallback runs)', () => {
  const out = run('groq', [
    groq('sorry, I cannot help'),
    groq({ foo: 1 }),
    groq({ rules: [] }),
    { error: { message: 'HTTP 429' } },
    {},
  ]);
  out.forEach((o) => { assert.strictEqual(o.valid, false); assert.strictEqual(o.extraction_status, 'invalid_groq'); });
});

test('tolerates code fences and prose around the JSON', () => {
  const [a, b] = run('groq', [
    groq('```json\n{"rules":[{"employment_types":["Salaried"],"min_age":21}]}\n```'),
    groq('Here you go: {"rules":[{"employment_types":["Business"],"min_income":40000}]} hope that helps'),
  ]);
  assert.strictEqual(a.valid, true);
  assert.strictEqual(b.min_income, 40000);
});

test('Gemini response shape is parsed and status is stamped', () => {
  const [r] = run('gemini', [gemini({ rules: [{ employment_types: ['Salaried'], min_income: 15000 }] })]);
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.extraction_status, 'llm_gemini');
});

test('qualitative text: "null"-ish strings become null, long text is truncated', () => {
  const [a, b] = run('groq', [
    groq({ rules: [{ employment_types: ['Salaried'] }], qualitative_criteria: 'None' }),
    groq({ rules: [{ employment_types: ['Salaried'] }], qualitative_criteria: 'x'.repeat(900) }),
  ]);
  assert.strictEqual(a.qualitative_criteria_text, null);
  assert.strictEqual(b.qualitative_criteria_text.length, 400);
});

test('self-employed implies business; salaried-only stays salaried-only', () => {
  const [a, b] = run('groq', [
    groq({ rules: [{ employment_types: ['Self-Employed'], min_age: 25 }] }),
    groq({ rules: [{ employment_types: ['Salaried'], min_age: 25 }] }),
  ]);
  assert.deepStrictEqual(a.allowed_employment_types, ['Self-Employed', 'Business']);
  assert.deepStrictEqual(b.allowed_employment_types, ['Salaried']);
});

function runWithText(provider, eligibilityText, llmResponses) {
  const originals = llmResponses.map((_, i) => ({ source_site: 's', product_name: `P${i}`, eligibility_text: eligibilityText }));
  const wrap = (arr) => arr.map((j, i) => ({ json: j, pairedItem: { item: i } }));
  const fn = new Function('$input', '$', 'URL', `"use strict"; ${SRC.replace('__PROVIDER__', provider)}`);
  return fn({ all: () => wrap(llmResponses) }, () => ({ itemMatching: (i) => wrap(originals)[i] }), undefined).map((r) => r.json);
}

test('safety net: a page that never mentions self-employed cannot grant Self-Employed or Business (Axis / Canara case)', () => {
  const [r] = runWithText('groq', 'Employees of private limited companies and PSUs are eligible. Axis also offers loans for doctors. Age 21 to 60.',
    [groq({ rules: [{ employment_types: ['Salaried', 'Self-Employed', 'Business'], min_income: 15000, min_age: 21, max_age: 60 }] })]);
  assert.deepStrictEqual(r.allowed_employment_types, ['Salaried']);
  assert.deepStrictEqual(r.eligibility_rules[0].employment_types, ['Salaried']);
});

test('safety net: when the page does mention self-employed applicants the LLM answer is kept', () => {
  const [r] = runWithText('groq', 'Salaried and self-employed professionals can apply.',
    [groq({ rules: [{ employment_types: ['Salaried', 'Self-Employed'], min_age: 21 }] })]);
  assert.deepStrictEqual(r.allowed_employment_types, ['Salaried', 'Self-Employed', 'Business']);
});

test('a credit score that is only soft guidance on the page is dropped', () => {
  const body = groq({ rules: [{ employment_types: ['Salaried'], min_credit_score: 750, min_age: 21, max_age: 60 }] });
  const [soft] = run('groq', [body], 'Salaried applicants aged 21 to 60. A CIBIL score of 750 or above usually gives higher chances of approval.');
  assert.strictEqual(soft.min_credit_score, null, 'advice is not a requirement');
  assert.strictEqual(soft.min_age, 21, 'other fields are untouched');
  const [hard] = run('groq', [body], 'Salaried applicants aged 21 to 60. Minimum CIBIL score of 750 is required.');
  assert.strictEqual(hard.min_credit_score, 750);
  const [absent] = run('groq', [body], 'Salaried applicants aged 21 to 60.');
  assert.strictEqual(absent.min_credit_score, null, 'a score that is nowhere in the text is invented');
});

test('a score in a table row whose keyword is in the previous sentence is still a requirement (IDFC-style)', () => {
  const body = groq({ rules: [{ employment_types: ['Self-Employed'], min_credit_score: 760, min_age: 21, max_age: 60 }] });
  const [r] = run('groq', [body], 'Self-employed individuals can apply. CIBIL score: For salaried: 710+. For self-employed: 760+.');
  assert.strictEqual(r.min_credit_score, 760);
});
