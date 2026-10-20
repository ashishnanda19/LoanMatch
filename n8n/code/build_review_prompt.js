// n8n Code node: "Build review prompt"
// One item per LENDER (not per employment type): plan_reviews.sql groups a lender's stale
// segments, so one call returns a note for each of its employment types. The system prompt and the
// lender text are sent once instead of up to three times, which is what the free-tier token limit
// is measured in.
const SYSTEM = __SYSTEM_PROMPT__;

return $input.all().map(({ json: s }) => ({
  json: {
    ...s,
    system_prompt: SYSTEM,
    user_prompt:
      `Lender product: ${s.product_name}\n` +
      `Applicant employment types to assess: ${s.employment_types.join(', ')}\n\n` +
      `Lender's qualitative requirements (summary):\n${s.qualitative_criteria_text}\n\n` +
      `Lender's source eligibility text (ground truth):\n${s.source_text || '(not available)'}`,
  },
}));
