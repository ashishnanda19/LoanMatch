// n8n Code node: "Validate <provider> output"  (mode: Run Once for All Items)
// One source file; scripts/build_workflows.py stamps PROVIDER in for the Groq and Gemini copies.
//
// Input : raw HTTP responses from the LLM node (or error items if the call failed).
// Output: the original lender item + `valid`, `extraction_status` and, when valid, the
//         normalised fields that go into loan_products.
//
// The LLM is only trusted for *reading the text*. Everything structural is enforced here:
// numeric ranges, employment-type vocabulary, duplicate-rule merging, and the derived
// "envelope" columns used by the Stage 1 SQL pre-filter.

const PROVIDER = '__PROVIDER__'; // 'groq' | 'gemini'
const TYPES = ['Salaried', 'Self-Employed', 'Business'];
// Safety net behind the prompt: if the lender's page never mentions self-employed / business /
// non-salaried applicants anywhere, the LLM must not grant those types (it once added them for "doctors"
// and for an employer-based product, which matched ~9,000 self-employed users to salaried-only lenders).
const OTHER_TYPES_MENTIONED = /self[\s-]?employed|\bbusiness(?:es|man|men| owner)|proprietor|entrepreneur|msme|\btraders?\b|partnership|non[\s-]?salaried|professionals?/i;

// A credit-score floor must be a REQUIREMENT stated on the page. Comparison sites are full of advice such as
// "a score of 750 or above gives higher chances"; the LLM sometimes turns that into min_credit_score=750,
// which would wrongly flag or reject users. Keep the value only if some sentence containing that number and
// the words cibil/credit score is not soft guidance.
const SOFT_GUIDANCE = /\b(usually|generally|typically|ideally|ideal|preferred|prefer|recommended|good|better|higher chances?|improve|increase your chances|most lenders|many lenders|other lenders|lenders (?:usually|generally|prefer))\b/i;
function scoreIsRequirement(score, text) {
  if (score === null) return true;
  const sentences = String(text || '').split(/(?<=[.!?])\s+|\n/);
  // Tables flatten to "CIBIL score: For salaried: 710+. For self-employed: 760+.", so the keyword may sit in the
  // previous sentence; look at each sentence together with the one before it.
  const num = new RegExp(`\\b${score}\\b`);
  const mentions = sentences.filter((s, i) => num.test(s) && /cibil|credit score|credit rating|\bscore\b/i.test(`${sentences[i - 1] || ''} ${s}`));
  return mentions.some((s) => !SOFT_GUIDANCE.test(s));
}

function responseText(res) {
  if (!res || res.error) return null;
  if (PROVIDER === 'groq') return (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || null;
  const parts = res.candidates && res.candidates[0] && res.candidates[0].content && res.candidates[0].content.parts;
  return parts ? parts.map((p) => p.text || '').join('') : null;
}

function parseJson(t) {
  if (!t) return null;
  t = t.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (e) { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}/); // tolerate prose around the object
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* give up */ } }
  return null;
}

const toInt = (v) => {
  const n = typeof v === 'string' ? parseInt(v.replace(/[,₹\s]|rs\.?/gi, ''), 10) : v;
  return Number.isInteger(n) ? n : null;
};
const inRange = (v, lo, hi) => { const n = toInt(v); return n !== null && n >= lo && n <= hi ? n : null; };

function normType(t) {
  const s = String(t || '').toLowerCase().replace(/[\s_]+/g, '-');
  if (/^salaried|^employee/.test(s)) return 'Salaried';
  if (/^self/.test(s)) return 'Self-Employed';
  if (/^business|^proprietor|^msme|^trader/.test(s)) return 'Business';
  return null;
}

function cleanRule(r, allowOtherTypes) {
  if (!r || typeof r !== 'object') return null;
  let types = (Array.isArray(r.employment_types) ? r.employment_types : []).map(normType).filter(Boolean);
  if (!types.length) types = ['Salaried']; // no applicant type named: personal loans are employer-based unless stated
  if (!allowOtherTypes) types = ['Salaried'];
  // Indian lenders use "self-employed" to cover business owners too (self-employed
  // professionals AND self-employed non-professionals/businessmen). Our CSV splits them
  // into two categories, so a lender that accepts one accepts the other.
  if (types.includes('Self-Employed') && !types.includes('Business')) types.push('Business');
  const rule = {
    types: [...new Set(types)],
    min_income: inRange(r.min_income, 3000, 1000000), // monthly INR
    min_credit_score: inRange(r.min_credit_score, 300, 900),
    min_age: inRange(r.min_age, 18, 80),
    max_age: inRange(r.max_age, 18, 100),
  };
  if (rule.min_age !== null && rule.max_age !== null && rule.min_age > rule.max_age) {
    rule.min_age = null; rule.max_age = null; // contradictory => don't trust either
  }
  return rule;
}

const minNN = (a) => { const v = a.filter((x) => x !== null); return v.length ? Math.min(...v) : null; };
const maxNN = (a) => { const v = a.filter((x) => x !== null); return v.length ? Math.max(...v) : null; };

// Several rules may cover the same employment type (LLM split by sub-category, or
// repeated itself). Collapse to ONE permissive rule per type, then regroup types that
// ended up identical, so rules never overlap.
function mergeRules(rules) {
  const perType = {};
  for (const t of TYPES) {
    const rs = rules.filter((r) => r.types.includes(t));
    if (!rs.length) continue;
    perType[t] = {
      min_income: minNN(rs.map((r) => r.min_income)),
      min_credit_score: minNN(rs.map((r) => r.min_credit_score)),
      min_age: minNN(rs.map((r) => r.min_age)),
      max_age: maxNN(rs.map((r) => r.max_age)),
    };
  }
  const groups = new Map();
  for (const t of Object.keys(perType)) {
    const k = JSON.stringify(perType[t]);
    if (!groups.has(k)) groups.set(k, { employment_types: [], ...perType[t] });
    groups.get(k).employment_types.push(t);
  }
  return [...groups.values()];
}

// Envelope = a SUPERSET of every rule, so the SQL pre-filter can never drop a user who
// qualifies under any rule. A null in any rule (= unstated) forces the envelope to null.
function envelope(rules) {
  const all = (k) => rules.map((r) => r[k]);
  const anyNull = (k) => all(k).some((v) => v === null);
  return {
    min_income: anyNull('min_income') ? null : Math.min(...all('min_income')),
    min_credit_score: anyNull('min_credit_score') ? null : Math.min(...all('min_credit_score')),
    min_age: anyNull('min_age') ? null : Math.min(...all('min_age')),
    max_age: anyNull('max_age') ? null : Math.max(...all('max_age')),
    allowed_employment_types: TYPES.filter((t) => rules.some((r) => r.employment_types.includes(t))),
  };
}

return $input.all().map((item, i) => {
  const original = $('Build LLM prompt').itemMatching(i).json; // follows paired-item lineage
  const fail = (why) => ({ json: { ...original, valid: false, extraction_status: `invalid_${PROVIDER}`, llm_error: why } });

  if (item.json && item.json.error) return fail(`request failed: ${JSON.stringify(item.json.error).slice(0, 200)}`);
  const parsed = parseJson(responseText(item.json));
  if (!parsed || !Array.isArray(parsed.rules) || parsed.rules.length === 0) return fail('response was not the expected JSON');

  const allowOtherTypes = OTHER_TYPES_MENTIONED.test(String(original.eligibility_text || ''));
  const cleaned = parsed.rules.map((r) => cleanRule(r, allowOtherTypes)).filter(Boolean);
  for (const r of cleaned) {
    if (!scoreIsRequirement(r.min_credit_score, original.eligibility_text)) r.min_credit_score = null;
  }
  if (!cleaned.length) return fail('no usable rules');
  const rules = mergeRules(cleaned);

  let q = typeof parsed.qualitative_criteria === 'string' ? parsed.qualitative_criteria.trim() : null;
  if (q && (q.length < 3 || /^(null|none|n\/a)$/i.test(q))) q = null;
  if (q && q.length > 400) q = q.slice(0, 397) + '...';

  return {
    json: {
      ...original,
      valid: true,
      extraction_status: `llm_${PROVIDER}`,
      ...envelope(rules),
      eligibility_rules: rules,
      qualitative_criteria_text: q,
      raw_criteria_text: (original.eligibility_text || '').slice(0, 3500),
    },
  };
});
