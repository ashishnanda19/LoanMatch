// n8n Code node: "Parse lender tables"  (mode: Run Once for All Items)
//
// Input : one item per list page, from "Fetch list page" (json.data = page HTML).
// Output: one item per lender row found in the rate tables:
//         { source_site, product_name, interest_rate, rate_text, max_amount_text,
//           tenure_text, fee_text, detail_url }
//
// Deterministic on purpose: the rate tables are clean HTML, so an LLM here would only
// add cost and the chance of hallucinated numbers.

const MAX_LENDERS_PER_SITE = 40; // safety valve against a layout change exploding the crawl
const out = [];

const ENT = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', rupee: '₹' };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));
const text = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const stripNoise = (h) => h.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '');

// "9.99% onwards*" -> 9.99 ; "10.00% - 30.50%" -> 10 (lowest advertised) ;
// "1.25% per month" -> 15 (annualised, simple) ; "Up to 36% p.a." -> 36
function parseRate(t) {
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  let r = parseFloat(m[1]);
  if (/per\s*month|p\.?\s*m\.?\b/i.test(t)) r *= 12;
  return Math.round(r * 100) / 100;
}

// Resolve a link against the page it was found on. Done by hand because n8n's Code-node
// sandbox does not expose the URL global.
function absoluteUrl(href, base) {
  if (/^https?:\/\//i.test(href)) return href;
  const origin = (base.match(/^https?:\/\/[^/]+/i) || [''])[0];
  if (href.startsWith('//')) return base.split(':')[0] + ':' + href;
  if (href.startsWith('/')) return origin + href;
  return base.replace(/[^/]*$/, '') + href; // relative to the current "directory"
}

function normaliseName(n) {
  n = n.replace(/\s+/g, ' ').trim();
  return /personal loan/i.test(n) ? n : `${n} Personal Loan`;
}

$input.all().forEach((inp, idx) => {
  const { source_site, list_url } = $('Seed sources').itemMatching(idx).json;
  const res = inp.json;
  const html = res && typeof res.data === 'string' ? res.data : '';
  if (!html || html.length < 5000) {
    // Layout/fetch problem: record it and move on, never crash the whole crawl.
    console.log(`[${source_site}] empty/short response (${html.length} bytes) - skipping site`);
    return;
  }

  const tables = stripNoise(html).match(/<table[\s\S]*?<\/table>/gi) || [];
  const seen = new Set();
  let count = 0;

  for (const t of tables) {
    const rows = t.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    if (rows.length < 2) continue;
    const header = (rows[0].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(text);
    const col = (re) => header.findIndex((h) => re.test(h));
    const cName = col(/^(bank|lender)/i);
    const cRate = col(/interest rate/i);
    if (cName !== 0 || cRate < 0) continue; // not a lender rate table
    const cAmt = col(/(max(imum)? )?loan amount/i);
    const cTen = col(/tenure/i);
    const cFee = col(/processing fee/i);

    for (const r of rows.slice(1)) {
      if (count >= MAX_LENDERS_PER_SITE) break;
      const cellsHtml = r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [];
      if (cellsHtml.length <= cRate) continue;
      const cells = cellsHtml.map(text);
      const name = normaliseName(cells[0]);
      if (!cells[0] || seen.has(name.toLowerCase())) continue;
      const href = (cellsHtml[0].match(/href="([^"]+)"/i) || [])[1];
      const detail_url = href ? absoluteUrl(decode(href), list_url) : null;
      seen.add(name.toLowerCase());
      count++;
      out.push({
        json: {
          source_site,
          product_name: name,
          interest_rate: parseRate(cells[cRate]),
          rate_text: cells[cRate],
          max_amount_text: cAmt >= 0 ? cells[cAmt] || null : null,
          tenure_text: cTen >= 0 ? cells[cTen] || null : null,
          fee_text: cFee >= 0 ? cells[cFee] || null : null,
          detail_url,
        },
      });
    }
  }
  const noLink = out.filter((o) => o.json.source_site === source_site && !o.json.detail_url).length;
  console.log(`[${source_site}] parsed ${count} lenders (${noLink} without a detail link)`);
});

return out;
