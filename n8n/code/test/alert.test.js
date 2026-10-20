// Tests for build_alert.js. Run: node --test n8n/code/test/alert.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'build_alert.js'), 'utf8');

function run(errorPayload, alertTo = 'owner@example.com') {
  const fn = new Function('$input', '$', 'URL', `"use strict"; ${SRC}`);
  return fn({ first: () => ({ json: { alert_to: alertTo } }) }, () => ({ first: () => ({ json: errorPayload }) }), undefined)[0].json;
}
const payload = (over = {}) => ({
  workflow: { id: 'w1', name: 'B - User-Loan Matching' },
  execution: { id: '42', url: 'http://n8n.test/workflow/w1/executions/42', lastNodeExecuted: 'Stage 2: exact per-type rules',
    error: { message: 'relation "matches" does not exist' } }, ...over });

test('alert names the workflow, node, error and execution, and goes to the verified owner address', () => {
  const m = run(payload());
  assert.strictEqual(m.subject, '[Loan engine] B - User-Loan Matching failed');
  assert.strictEqual(m.to, 'owner@example.com');
  assert.strictEqual(m.from, 'owner@example.com');
  for (const s of ['Stage 2: exact per-type rules', 'does not exist', '42', 'open in n8n']) assert.ok(m.html.includes(s), s);
});

test('error text and workflow names are HTML-escaped and the subject cannot be split across lines', () => {
  const m = run(payload({ workflow: { name: 'Evil\r\nBcc: x@y.z <script>' }, execution: { id: '1', error: { message: '<img src=x onerror=1>' } } }));
  assert.ok(!/[\r\n]/.test(m.subject));
  assert.ok(!m.html.includes('<img') && !m.html.includes('<script>'));
});

test('missing fields still produce a usable alert; a non-http link is not rendered', () => {
  const m = run({ execution: { url: 'javascript:alert(1)' } });
  assert.strictEqual(m.subject, '[Loan engine] unknown workflow failed');
  assert.ok(m.html.includes('unknown node') && m.html.includes('no error message'));
  assert.ok(!m.html.includes('javascript:'));
});

test('very long error messages are capped', () => {
  const m = run(payload({ execution: { id: '1', error: { message: 'x'.repeat(5000) } } }));
  assert.ok(m.html.length < 2500);
});
