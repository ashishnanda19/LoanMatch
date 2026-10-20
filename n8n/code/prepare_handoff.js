// n8n Code node: "Prepare hand-off"
// Tells Workflow C which batch just finished, so it emails only that batch's pending matches.
return [{ json: { batch_id: $('Validate payload').first().json.batch_id } }];
