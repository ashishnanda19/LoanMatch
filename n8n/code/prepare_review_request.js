// n8n Code node: "Prepare review request"
// After matching: ask Workflow R for notes on the lenders this batch's users actually matched.
return [{ json: { scope: 'used', batch_id: $('Validate payload').first().json.batch_id } }];
