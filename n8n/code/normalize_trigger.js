// n8n Code node: "Read batch id"
// Workflow C has three entry points: called by Workflow B ({batch_id}), the notify-now webhook
// ({body:{batch_id}}) or a manual run (no input). An empty batch id means "all pending matches".
const j = ($input.first() && $input.first().json) || {};
const id = j.batch_id || (j.body && j.body.batch_id) || '';
return [{ json: { batch_id: /^[0-9a-f-]{36}$/i.test(id) ? id : '' } }];
