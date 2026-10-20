// n8n Code node: "Collect rows to save"  (runs once per batch of lenders)
// Flattens the per-lender results into one JSON array for a single upsert query. Only valid
// segments are saved; a segment that no provider could review is left out and retried next run.
const rows = new Map();
const items = $input.all().map((i) => i.json);
for (const it of items) {
  const provider = String(it.extraction_status || '').replace(/^(llm|invalid)_/, '');
  for (const r of it.reviews || []) {
    if (!r.valid) continue;
    rows.set(`${it.product_id}|${r.employment_type}`, {
      product_id: it.product_id, employment_type: r.employment_type, criteria_hash: it.criteria_hash,
      verdict: r.verdict, caveat: r.caveat, provider: `llm_${provider}`,
    });
  }
}
return [{ json: { rows_json: JSON.stringify([...rows.values()]), lenders: items.length, rows: rows.size } }];
