// n8n Code node: "Build LLM prompt"
// Attaches the system + user prompt to each lender item. Both the Groq and the Gemini
// request nodes read these fields, so the two providers see the identical prompt.
const SYSTEM = __SYSTEM_PROMPT__;

return $input.all().map((item) => ({
  json: {
    ...item.json,
    system_prompt: SYSTEM,
    user_prompt: `Lender: ${item.json.product_name}\n\nEligibility text:\n${item.json.eligibility_text}`,
  },
}));
