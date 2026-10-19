// n8n Code node: "Review summary"  (runs once, after every review has been saved)
const merged = $('Merge review results').all().map((i) => i.json);
const count = (st) => merged.filter((m) => m.extraction_status === st).length;
return [{
  json: {
    llm_review_calls: merged.length,        // one call (or fallback pair) per segment
    reviewed_by_groq: count('llm_groq'),
    reviewed_by_gemini: count('llm_gemini'),
    review_failed: count('invalid_gemini'), // both models failed => retried on the next crawl
    reviews_saved: $input.all().reduce((n, i) => n + Number(i.json.saved || 0), 0),
  },
}];
