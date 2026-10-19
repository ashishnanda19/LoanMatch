// n8n Code node: "Extract eligibility text"  (mode: Run Once for All Items)
//
// Input : one item per lender detail page, from "Fetch lender page"
//         (json.data = HTML, or json.error if the fetch failed).
// Output: the lender fields from "Parse lender tables" plus `eligibility_text`
//         (<= ~2.5 KB: just the eligibility prose / key-facts table), so the LLM sees
//         a few hundred tokens instead of an 800 KB page.

const MAX_CHARS = 2500;

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

function eligibilityFrom(html) {
  const s = stripNoise(html);
  const chunks = [];

  // (a) key-facts tables, e.g. "Minimum Income Required | Rs.15,000"
  for (const t of s.match(/<table[\s\S]*?<\/table>/gi) || []) {
    for (const r of t.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
      const cells = (r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(text);
      if (cells.length === 2 && /minimum (net )?(monthly )?(income|salary)|min\.? (income|salary)|age limit|cibil|credit score/i.test(cells[0])) {
        chunks.push(`${cells[0]}: ${cells[1]}`);
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
    chunks.push(`${heading}: ${body}`);
    found++;
    i = j - 2; // resume after this section
  }
  return chunks.join('\n').slice(0, MAX_CHARS);
}

return $input.all().map((item, i) => {
  const src = $('Parse lender tables').itemMatching(i).json;
  const html = item.json && typeof item.json.data === 'string' ? item.json.data : '';
  const eligibility_text = html ? eligibilityFrom(html) : '';
  if (!eligibility_text) console.log(`no eligibility text for ${src.source_site} / ${src.product_name}`);
  return { json: { ...src, eligibility_text } };
});
