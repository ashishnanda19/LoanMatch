// n8n Code node: "Build review prompt"
// One item per (product x employment-type) segment, produced by plan_reviews.sql. The prompt
// carries the lender's fuzzy criteria and source text; no applicant data is needed because
// the model only annotates what the customer still has to check.
const SYSTEM = __SYSTEM_PROMPT__;

return $input.all().map(({ json: s }) => ({
  json: {
    ...s,
    system_prompt: SYSTEM,
    user_prompt:
      `Lender product: ${s.product_name}\n` +
      `Applicant employment type: ${s.employment_type}\n\n` +
      `Lender's qualitative requirements (summary):\n${s.qualitative_criteria_text}\n\n` +
      `Lender's source eligibility text (ground truth):\n${s.source_text || '(not available)'}`,
  },
}));
