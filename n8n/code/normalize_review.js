// n8n Code node: "Validate <provider> review"  (stamped per provider by build_workflows.py)
// One LLM response covers ONE lender and all of its requested employment types. Output is one item
// per lender: {reviews:[{employment_type, valid, verdict, caveat}], all_valid, extraction_status}.
// all_valid=false (bad JSON, a missing type, an unknown verdict) sends the lender to the fallback.
const PROVIDER = '__PROVIDER__'; // 'groq' | 'gemini'
// The reviewer may only grade a segment 'eligible' or 'conditional'. An LLM veto proved unreliable on
// real data (it applied a salaried income floor to self-employed applicants, excluded employment types
// the lender accepts, and flipped between runs), so 'ineligible' is demoted to 'conditional': numeric
// rules and employment types are verified exactly in SQL (Stages 1-2), and the LLM must not silently
// remove a user on its own judgement.
const VERDICTS = ['eligible', 'conditional', 'ineligible'];

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
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) { /* give up */ } }
  return null;
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');

function reviewOne(entry) {
  if (!entry || typeof entry !== 'object') return { valid: false };
  let verdict = typeof entry.verdict === 'string' ? entry.verdict.trim().toLowerCase() : null;
  if (!VERDICTS.includes(verdict)) return { valid: false };
  const demoted = verdict === 'ineligible';
  if (demoted) verdict = 'conditional';
  let caveat = typeof entry.caveat === 'string' ? entry.caveat.trim() : null;
  if (caveat && /^(null|none|n\/a)$/i.test(caveat)) caveat = null;
  if (caveat && caveat.length > 160) caveat = caveat.slice(0, 157) + '...';
  if (verdict === 'eligible') caveat = null;
  if (demoted && !caveat) caveat = 'The lender has extra requirements we could not check.';
  return { valid: true, verdict, caveat, demoted };
}

return $input.all().map((item, i) => {
  const original = $('Build review prompt').itemMatching(i).json;
  const types = original.employment_types;
  const out = (reviews, status, extra) => ({
    json: { ...original, reviews, all_valid: reviews.every((r) => r.valid), extraction_status: status, ...extra },
  });
  const failAll = (why) => out(types.map((t) => ({ employment_type: t, valid: false })), `invalid_${PROVIDER}`, { llm_error: why });

  if (item.json && item.json.error) return failAll(`request failed: ${JSON.stringify(item.json.error).slice(0, 160)}`);
  const parsed = parseJson(responseText(item.json));
  const block = parsed && typeof parsed.reviews === 'object' && parsed.reviews ? parsed.reviews : null;
  if (!block) return failAll('response was not the expected JSON');

  const byKey = {};
  Object.keys(block).forEach((k) => { byKey[norm(k)] = block[k]; });
  const reviews = types.map((t) => ({ employment_type: t, ...reviewOne(byKey[norm(t)]) }));
  const ok = reviews.every((r) => r.valid);
  return out(reviews, ok ? `llm_${PROVIDER}` : `invalid_${PROVIDER}`, {});
});
