// n8n Code node: "Build email"  (one item in per user, one email out per user)
// Input : a row from pending_notifications.sql {user_id, name, recipient_email, sender_email, products[]}
// Output: {user_id, to, from, subject, html, match_ids}
// Everything that came from the CSV or a crawled page is HTML-escaped, and the subject is forced
// onto a single line (a name containing a newline must not be able to inject mail headers).
const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const oneLine = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const rate = (r) => (r === null || r === undefined || r === '' || isNaN(Number(r)) ? 'Rate on request' : `From ${Number(r).toFixed(2)}% p.a.`);

// The user's score against the lender's minimum. A flag means the lender states a higher minimum for
// another applicant type and none for this one, so we cannot promise the match.
const scoreCell = (p, score) => {
  const mine = Number(score);
  if (p.score_flag) {
    return `<span style="color:#b45309"><b>Check:</b> your score is ${esc(mine)}; ${esc(p.floor_any)} is required for other applicants and none is stated for your category</span>`;
  }
  if (p.floor_own !== null && p.floor_own !== undefined) return `Your ${esc(mine)} meets the ${esc(p.floor_own)} minimum`;
  if (p.floor_any !== null && p.floor_any !== undefined) return `Minimum not stated for you; your ${esc(mine)} is above the ${esc(p.floor_any)} others need`;
  return `Lender does not publish a minimum (your score: ${esc(mine)})`;
};

return $input.all().map(({ json: u }) => {
  const products = Array.isArray(u.products) ? u.products : [];
  const first = oneLine(u.name).split(' ')[0] || 'there';
  const n = products.length;
  const rows = products.map((p, i) => {
    const note = p.caveat
      ? `<span style="color:#8a5a00">Check: ${esc(p.caveat)}</span>`
      : (p.verdict === 'eligible' ? 'No extra conditions found' : 'Final approval by the lender');
    return `<tr>` +
      `<td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:600">${i + 1}</td>` +
      `<td style="padding:10px;border-bottom:1px solid #e5e7eb">${esc(oneLine(p.product))}</td>` +
      `<td style="padding:10px;border-bottom:1px solid #e5e7eb;white-space:nowrap">${esc(rate(p.rate))}</td>` +
      `<td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:13px">${scoreCell(p, u.credit_score)}</td>` +
      `<td style="padding:10px;border-bottom:1px solid #e5e7eb;font-size:13px">${note}</td></tr>`;
  }).join('');
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:640px;margin:auto;color:#111827">` +
    `<h2 style="margin-bottom:4px">Hi ${esc(first)}, here are your best personal loan matches</h2>` +
    `<p style="margin-top:0;color:#4b5563">We compared your income, credit score, age and employment type with ` +
    `current lender criteria (your credit score: ${esc(oneLine(u.credit_score))}). These ${n} lender${n === 1 ? '' : 's'} fit you best: ` +
    `matches we are sure about first, then lowest interest rate.</p>` +
    `<table style="width:100%;border-collapse:collapse;font-size:14px">` +
    `<tr style="background:#f3f4f6;text-align:left"><th style="padding:10px">#</th><th style="padding:10px">Lender</th>` +
    `<th style="padding:10px">Interest rate</th><th style="padding:10px">Credit score</th><th style="padding:10px">Good to know</th></tr>${rows}</table>` +
    `<p style="font-size:12px;color:#6b7280;margin-top:20px">Rates are indicative, taken from lender websites, ` +
    `and the final decision rests with each lender.</p></div>`;
  return {
    json: {
      user_id: u.user_id,
      to: u.recipient_email,
      from: u.sender_email,
      subject: `${first}, your ${n} best personal loan match${n === 1 ? '' : 'es'}`.slice(0, 200),
      html,
      match_ids: products.map((p) => p.match_id),
    },
  };
});
