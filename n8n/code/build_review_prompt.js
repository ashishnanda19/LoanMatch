// n8n Code node: "Build review prompt"
// One item per (product x employment-type) segment. The prompt carries the lender's fuzzy
// criteria plus the segment's real ranges from the database, so the model judges this
// segment rather than guessing about a generic applicant.
const SYSTEM = __SYSTEM_PROMPT__;
const inr = (n) => '\u20b9' + Number(n).toLocaleString('en-IN');

return $input.all().map(({ json: s }) => ({
  json: {
    ...s,
    system_prompt: SYSTEM,
    user_prompt:
      `Lender product: ${s.product_name}\n` +
      `Applicant segment: ${s.employment_type}, ${s.candidates} applicants\n` +
      `Monthly income: ${inr(s.income_min)} to ${inr(s.income_max)} (median ${inr(s.income_median)})\n` +
      `Credit score: ${s.score_min} to ${s.score_max}\n` +
      `Age: ${s.age_min} to ${s.age_max}\n\n` +
      `Employment types the lender's structured data accepts: ${s.accepted_types || 'not stated'}\n\n` +
      `Lender's qualitative requirements (summary):\n${s.qualitative_criteria_text}\n\n` +
      `Lender's source eligibility text (ground truth):\n${s.source_text || '(not available)'}`,
  },
}));
