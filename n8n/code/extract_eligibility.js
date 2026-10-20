// n8n Code node: "Extract eligibility text"  (mode: Run Once for All Items)
//
// Input : one item per lender detail page, from "Fetch lender page"
//         (json.data = HTML, or json.error if the fetch failed).
// Output: the lender fields from "Parse lender tables" plus `eligibility_text`
//         (<= ~3.5 KB of eligibility facts), so the LLM sees a few hundred tokens instead of an 800 KB page.
//
// Three sources, in priority order:
//   (a) key-facts tables ("Minimum Income Required | Rs.15,000") - rate tables are skipped;
//   (b) the prose under headings that name eligibility;
//   (c) a SWEEP of the whole page for sentences that state an eligibility fact. Lenders do not put these
//       under a predictable heading (IndusInd under "Documentation Required", Canara under scheme names,
//       HDFC and IIFL in an unlabelled card), so (a)+(b) alone missed them. Sentences that appear on many
//       pages are site boilerplate, not this lender's rules, and are dropped.

const MAX_CHARS = 3500;

const ENT = { amp: '&', nbsp: ' ', quot: '"', apos: "'", lt: '<', gt: '>', rupee: '₹' };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));
// Block-level tags become sentence breaks so list items don't run together.
const text = (h) =>
  decode(h.replace(/<\/(li|p|tr|div|h[1-6])>|<br\s*\/?>/gi, '. ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/(\.\s*){2,}/g, '. ')
    .trim();
const stripNoise = (h) => h.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, '');

// ---- sweep helpers -------------------------------------------------------------------------------
const FACT_RE = /\b(age|years?|income|salary|salaried|cibil|credit score|self[- ]employed|experience|resident|citizen|nationality|vintage|turnover|employed|employees?)\b/i;
const HARD_RE = /(minimum|maximum|min\.|max\.|at least|at most|between|within|should be|must|required|not less than|less than|more than|above|below|up to|only|\d+\s*(?:years?\s*)?(?:to|-|\u2013)\s*\d+)/i;
const SWEEP_SKIP = /(calculator|credit card|home loan|documents? required|processing fee|prepayment|foreclosure|late payment|\bGST\b|insurance|pension|pensioner|senior citizen|apply now|click here|latest salary slip|salary slips?)/i;
const SWEEP_NOISE = /^(loan amount|loan tenure|tenure|repayment tenure)\b|\d(?:\.\d+)?\s?%|customer care|helpline|\bEMI\b.*\bRs\b|lakhs?\s+up to \d+ years/i; // amounts, tenures and rates are not eligibility
const SECTION_MAX = 1500; // a heading section can swallow the rest of the page; keep room for the sweep
const BOILERPLATE_PAGES = 5; // a sentence on this many pages is template text, not this lender's rule

const sentencesOf = (html) =>
  text(stripNoise(html)).replace(/\b(Rs|Mr|Dr|No|approx)\.\s/g, '$1 ')
    .split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 20 && x.length < 300);
const norm = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, '');

function eligibilityFrom(html, boilerplate) {
  const s = stripNoise(html);
  const chunks = [];
  const add = (c) => { if (!chunks.includes(c)) chunks.push(c); };

  // (a) key-facts tables, e.g. "Minimum Income Required | Rs.15,000". Rate tables ("Credit Score-Based Risk
  //     Grade | Interest Rates") also contain the word "credit score", so skip any table that is about rates.
  for (const t of s.match(/<table[\s\S]*?<\/table>/gi) || []) {
    const rows = t.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const head = (rows[0] ? (rows[0].match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(text) : []).join(' ');
    if (/interest|rate|tenure|emi|fee|charge|mclr/i.test(head)) continue;
    for (const r of rows) {
      const cells = (r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(text);
      if (cells.length === 2 && !/%/.test(cells[1]) && /minimum (net )?(monthly )?(income|salary)|min\.? (income|salary)|age limit|cibil|credit score/i.test(cells[0])) {
        add(`${cells[0]}: ${cells[1]}`);
      }
    }
  }

  // (b) the prose under an "Eligibility" heading (first two matching sections).
  // A section runs until the next heading of the same or higher level, so nested
  // sub-headings ("For salaried", "For self-employed") stay part of it.
  const parts = s.split(/(<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>)/i);
  const level = (h) => parseInt(h.match(/<h([1-4])/i)[1], 10);
  let found = 0;
  for (let i = 1; i < parts.length - 1 && found < 2; i += 2) {
    const heading = text(parts[i]);
    if (!/eligib|who can apply|criteria/i.test(heading)) continue;
    if (/top.?up|calculator|check your|how to/i.test(heading)) continue;
    const L = level(parts[i]);
    let body = text(parts[i + 1]);
    let j = i + 2;
    while (j < parts.length - 1 && level(parts[j]) > L) {
      body += ` ${text(parts[j])}: ${text(parts[j + 1])}`;
      j += 2;
    }
    if (body.length < 40) continue;
    add(`${heading}: ${body}`.slice(0, SECTION_MAX));
    found++;
    i = j - 2; // resume after this section
  }

  // (c) sweep: every sentence on the page that states an eligibility fact and was not captured above.
  const seen = norm(chunks.join(' '));
  const swept = [];
  for (const sen of sentencesOf(html)) {
    if (!FACT_RE.test(sen) || !/\d/.test(sen) || !HARD_RE.test(sen) || SWEEP_SKIP.test(sen) || SWEEP_NOISE.test(sen)) continue;
    if (boilerplate && boilerplate.has(sen)) continue;
    const k = norm(sen);
    if (seen.includes(k.slice(0, 60)) || swept.some((w) => norm(w).startsWith(k.slice(0, 60)))) continue;
    swept.push(sen);
  }
  let out = chunks.join('\n');
  if (swept.length) out += (out ? '\n' : '') + 'Other eligibility statements on the page: ' + swept.join(' ');
  return out.slice(0, MAX_CHARS);
}

const items = $input.all();
// Sentences that occur on several lenders' pages are template text (e.g. "a score of 750 is ideal").
const freq = new Map();
items.forEach((item) => {
  const html = item.json && typeof item.json.data === 'string' ? item.json.data : '';
  if (html) new Set(sentencesOf(html)).forEach((sen) => freq.set(sen, (freq.get(sen) || 0) + 1));
});
const boilerplate = new Set([...freq].filter(([, n]) => n >= BOILERPLATE_PAGES).map(([sen]) => sen));

return items.map((item, i) => {
  const src = $('Parse lender tables').itemMatching(i).json;
  const html = item.json && typeof item.json.data === 'string' ? item.json.data : '';
  const eligibility_text = html ? eligibilityFrom(html, boilerplate) : '';
  if (!eligibility_text) console.log(`no eligibility text for ${src.source_site} / ${src.product_name}`);
  return { json: { ...src, eligibility_text } };
});
