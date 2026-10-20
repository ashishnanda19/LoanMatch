// Tests for extract_eligibility.js: what the LLM gets to see. Run: node --test n8n/code/test/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'extract_eligibility.js'), 'utf8');

function run(pages) {
  const wrap = (arr) => arr.map((j, i) => ({ json: j, pairedItem: { item: i } }));
  const $input = { all: () => wrap(pages.map((html) => ({ data: html }))) };
  const meta = pages.map((_, i) => ({ source_site: 's', product_name: `P${i}` }));
  const $ = () => ({ itemMatching: (i) => wrap(meta)[i] });
  const fn = new Function('$input', '$', 'console', `"use strict"; ${SRC}`);
  return fn($input, $, { log() {} }).map((r) => r.json.eligibility_text);
}

test('a rate table that mentions "credit score" is not treated as a key-facts table', () => {
  const [t] = run([`<table><tr><th>Credit Score-Based Risk Grade</th><th>Interest Rates</th></tr>
    <tr><td>Credit Score 750+</td><td>10.5%</td></tr></table><h2>Eligibility Criteria</h2><p>Age 21 to 60 years and minimum income of Rs 25,000 per month.</p>`]);
  assert.ok(!/Risk Grade|10\.5%/.test(t), t);
  assert.match(t, /Age 21 to 60/);
});

test('facts in an unlabelled card (not under an eligibility heading) are still captured', () => {
  const [t] = run([`<h2>About the loan</h2><p class="x">Eligibility Criteria</p><ul>
    <li>Age at least 25 and less than 60</li><li>Minimum Monthly Income ₹25,000</li></ul>`]);
  assert.match(t, /Age at least 25 and less than 60/);
  assert.match(t, /Minimum Monthly Income ₹25,000/);
});

test('facts under a heading that does not say "eligibility" are captured by the sweep', () => {
  const [t] = run([`<h2>Documentation Required</h2><h3>For salaried employees</h3><ul>
    <li>Applicants age should be within 25 years to 65 years.</li><li>Monthly net income shouldn't be less than Rs.25,000.</li></ul>`]);
  assert.match(t, /25 years to 65 years/);
  assert.match(t, /less than Rs\.25,000/);
});

test('a sentence repeated on five pages is boilerplate and dropped; the unique rule stays', () => {
  const boiler = '<p>A credit score of at least 750 is ideal for any personal loan application.</p>';
  const pages = [1, 2, 3, 4, 5].map((n) => `${boiler}<p>Minimum age is ${20 + n} years for this lender.</p>`);
  const out = run(pages);
  out.forEach((t, i) => {
    assert.ok(!/ideal for any personal loan/.test(t), 'boilerplate leaked');
    assert.match(t, new RegExp(`Minimum age is ${21 + i} years`));
  });
});

test('output never exceeds the cap', () => {
  const li = Array.from({ length: 300 }, (_, i) => `<li>Applicant age must be at least ${18 + (i % 40)} years for product ${i}.</li>`).join('');
  const [t] = run([`<h2>Eligibility</h2><ul>${li}</ul>`]);
  assert.ok(t.length <= 3500, String(t.length));
});
