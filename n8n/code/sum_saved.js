// n8n Code node: "Total saved"  (runs once, when the loop has finished every batch)
// $input holds one {saved} row per batch.
return [{ json: { reviews_saved: $input.all().reduce((n, i) => n + Number(i.json.saved || 0), 0) } }];
