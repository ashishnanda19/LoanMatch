// n8n Code node: "Review summary"
const planned = $('Plan reviews (cache check)').all().filter((i) => i.json.product_id !== undefined);
const cov = $input.first().json;
const req = $('Read review request').first().json;
return [{
  json: {
    scope: req.scope,
    lenders_reviewed: planned.length,
    notes_saved: $('Total saved').first().json.reviews_saved,
    segments_in_scope: Number(cov.segments_in_scope),
    segments_with_current_note: Number(cov.with_current_note),
    segments_still_missing: Number(cov.missing),   // > 0 => a provider failed; retried on the next run
    finished_at: new Date().toISOString(),
  },
}];
