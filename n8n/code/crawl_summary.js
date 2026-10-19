// n8n Code node: "Crawl summary"  (runs once, after every upsert has finished)
// Only ancestors of this node can be read with $(...); the skipped/dropped NoOp branches
// are siblings, so derive their counts from ancestors instead.
const hasText = $('Extract eligibility text').all().filter((i) => i.json.eligibility_text);
const totalLenders = $('Extract eligibility text').all().length;
const rows = $input.all().map((i) => i.json);
const by = {};
rows.forEach((r) => { by[r.source_site] = (by[r.source_site] || 0) + 1; });

return [{
  json: {
    upserted_products: rows.length,
    upserted_by_site: by,
    lenders_found: totalLenders,
    skipped_no_eligibility_text: totalLenders - hasText.length,
    dropped_llm_failed: hasText.length - rows.length,
    finished_at: new Date().toISOString(),
  },
}];
