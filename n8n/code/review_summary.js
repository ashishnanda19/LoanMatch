// n8n Code node: "Review summary"  (runs once, when the loop has saved every batch)
// $input holds one {saved} item per segment that went through the loop.
const planned = $('Plan reviews (cache check)').all().filter((i) => i.json.product_id !== undefined).length;
const saved = $input.all().reduce((n, i) => n + Number(i.json.saved || 0), 0);
return [{
  json: {
    segments_planned: planned,
    reviews_saved: saved,
    reviews_failed: planned - saved,   // both LLMs failed; picked up again on the next run
    finished_at: new Date().toISOString(),
  },
}];
