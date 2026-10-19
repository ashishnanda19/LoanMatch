// n8n Code node: "Collect canonical product ids"  (runs once)
// Folds the reconciled lenders into the single item the SQL stages need.
const lenders = $input.all().map((i) => i.json);
return [{
  json: {
    batch_id: $('Validate payload').first().json.batch_id,
    product_ids: lenders.map((l) => l.product_id),
    products_fresh: $('Load fresh products').all().length,
    products_canonical: lenders.length,
    merged_groups: lenders.filter((l) => l.products_in_group > 1).length,
  },
}];
