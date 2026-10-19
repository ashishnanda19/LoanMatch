// n8n Code node: "Validate <provider> review"  (stamped per provider by build_workflows.py)
// Turns a raw LLM response into {valid, verdict, caveat}. Anything that is not exactly one of
// the three verdicts is invalid, which routes the item to the Gemini fallback (or, after
// Gemini, leaves the segment unreviewed => it is simply retried on the next crawl).
const PROVIDER = '__PROVIDER__'; // 'groq' | 'gemini'
// The reviewer may only grade a segment 'eligible' or 'conditional'. An LLM veto proved
// unreliable on real data (it applied a salaried income floor to self-employed applicants,
// excluded employment types the lender accepts, and flipped between runs), so 'ineligible'
// is demoted to 'conditional': numeric rules and employment types were already verified
// exactly in SQL (Stages 1-2), and the LLM must not silently remove a user on its own judgement.
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

return $input.all().map((item, i) => {
  const original = $('Build review prompt').itemMatching(i).json;
  const fail = (why) => ({ json: { ...original, valid: false, extraction_status: `invalid_${PROVIDER}`, llm_error: why } });
  if (item.json && item.json.error) return fail(`request failed: ${JSON.stringify(item.json.error).slice(0, 160)}`);

  const parsed = parseJson(responseText(item.json));
  let verdict = parsed && typeof parsed.verdict === 'string' ? parsed.verdict.trim().toLowerCase() : null;
  if (!VERDICTS.includes(verdict)) return fail('response had no valid verdict');
  const demoted = verdict === 'ineligible';
  if (demoted) verdict = 'conditional';

  let caveat = typeof parsed.caveat === 'string' ? parsed.caveat.trim() : null;
  if (caveat && /^(null|none|n\/a)$/i.test(caveat)) caveat = null;
  if (caveat && caveat.length > 160) caveat = caveat.slice(0, 157) + '...';
  if (verdict === 'eligible') caveat = null;
  if (demoted && !caveat) caveat = 'The lender has extra requirements we could not check.';

  return { json: { ...original, valid: true, extraction_status: `llm_${PROVIDER}`, verdict, caveat, demoted_ineligible: demoted } };
});
