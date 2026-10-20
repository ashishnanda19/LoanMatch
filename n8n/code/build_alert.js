// n8n Code node: "Build alert"
// Turns the Error Trigger payload into one short, plain email. Anything that came from an error message
// is HTML-escaped (error text can echo user data) and capped, and the subject stays on one line.
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

const e = $('Error Trigger').first().json || {};
const ex = e.execution || {};
const workflow = oneLine((e.workflow && e.workflow.name) || 'unknown workflow').slice(0, 120);
const node = oneLine(ex.lastNodeExecuted || (ex.error && ex.error.node && ex.error.node.name) || 'unknown node').slice(0, 120);
const message = oneLine((ex.error && ex.error.message) || 'no error message').slice(0, 500);
const to = ($input.first() && $input.first().json && $input.first().json.alert_to) || null;
const link = typeof ex.url === 'string' && /^https?:\/\//.test(ex.url) ? ex.url : null;

const html =
  `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px">` +
  `<h3 style="margin-bottom:4px">${esc(workflow)} failed</h3>` +
  `<table style="font-size:14px;border-collapse:collapse">` +
  `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Node</td><td>${esc(node)}</td></tr>` +
  `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Error</td><td>${esc(message)}</td></tr>` +
  `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Execution</td><td>${esc(ex.id || 'n/a')}${link ? ` - <a href="${esc(link)}">open in n8n</a>` : ''}</td></tr>` +
  `</table></div>`;

return [{ json: { to, from: to, subject: `[Loan engine] ${workflow} failed`, html } }];
