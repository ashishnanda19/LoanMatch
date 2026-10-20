// n8n Code node: "Read review request"
// Workflow R is started three ways: by Workflow B ({scope:'used', batch_id}), by the crawler / the
// review-now webhook / a manual run (no scope => 'all').
//   used : only the lender+employment-type pairs that appear in this batch's matches (blocks the emails)
//   all  : every fresh lender, so the cache is complete even for an outlier no user has hit yet
const j = ($input.first() && $input.first().json) || {};
const body = j.body && typeof j.body === 'object' ? j.body : {};
const id = String(j.batch_id || body.batch_id || '');
const batch_id = /^[0-9a-f-]{36}$/i.test(id) ? id : '';
const wanted = j.scope || body.scope;
const scope = wanted === 'used' && batch_id ? 'used' : 'all';
return [{ json: { scope, batch_id } }];
