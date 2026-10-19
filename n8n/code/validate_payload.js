// n8n Code node: "Validate payload"
// The parse-csv Lambda POSTs {batch_id, row_count}. Reject anything that is not a UUID so a
// malformed or hostile request can never reach the SQL stages. (Webhook v2 nests the JSON
// under `body`.)
const raw = $input.first().json;
const b = raw.body && typeof raw.body === 'object' ? raw.body : raw;
const id = String(b.batch_id || '').trim().toLowerCase();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
  throw new Error(`invalid batch_id in webhook payload: ${JSON.stringify(b.batch_id)}`);
}
return [{ json: { batch_id: id, row_count: Number(b.row_count) || 0, received_at: new Date().toISOString() } }];
