// n8n Code node: "Stage 0: reconcile lenders"  (mode: Run Once for All Items)
//
// Input : fresh loan_products rows (one item each).
// Output: ONE item per lender. The same lender shows up on several sites with different
//         (sometimes conflicting) thresholds; matching a user against both would list the
//         lender twice in an email, and the strict/lenient disagreement has no right answer.
//         We keep the single most authoritative record and record what was dropped.
//
// Authority order: the lender's own site > the record that states more criteria >
// aggregator rank (Paisabazaar before BankBazaar) > lower advertised rate.

const OFFICIAL = new Set(['bajajfinserv']);
const SOURCE_RANK = { bajajfinserv: 0, paisabazaar: 1, bankbazaar: 2 };
const STOP = new Set(['personal', 'loan', 'bank', 'of', 'india', 'finance', 'finserv', 'first',
                      'mahindra', 'capital', 'ltd', 'limited', 'and']);

// "HDFC Bank Personal Loan" / "HDFC Personal Loan" -> "hdfc"; "Bank of India" -> "bank of india"
function lenderKey(name) {
  const norm = name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const core = norm.split(' ').filter((t) => !STOP.has(t));
  return core.length ? core.join(' ') : norm.replace(/\s*personal loan$/, '');
}

function completeness(p) {
  let n = 0;
  for (const k of ['min_income', 'min_credit_score', 'min_age', 'max_age']) if (p[k] !== null && p[k] !== undefined) n++;
  return n + (Array.isArray(p.eligibility_rules) ? p.eligibility_rules.length * 0.1 : 0);
}

function better(a, b) {
  const oa = OFFICIAL.has(a.source_site), ob = OFFICIAL.has(b.source_site);
  if (oa !== ob) return oa;
  const ca = completeness(a), cb = completeness(b);
  if (ca !== cb) return ca > cb;
  const ra = SOURCE_RANK[a.source_site] ?? 9, rb = SOURCE_RANK[b.source_site] ?? 9;
  if (ra !== rb) return ra < rb;
  return Number(a.interest_rate) <= Number(b.interest_rate);
}

const groups = new Map();
for (const { json: p } of $input.all()) {
  const key = lenderKey(p.product_name);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(p);
}

const out = [];
for (const [key, rows] of groups) {
  let best = rows[0];
  for (const r of rows.slice(1)) if (better(r, best)) best = r;
  out.push({
    json: {
      ...best,
      lender_key: key,
      reconciled_from: rows.map((r) => `${r.source_site}#${r.product_id}`),
      products_in_group: rows.length,
    },
  });
}
console.log(`reconciled ${$input.all().length} products into ${out.length} lenders`);
return out.sort((a, b) => a.json.lender_key.localeCompare(b.json.lender_key));
