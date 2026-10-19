// n8n Code node: "Seed sources"
// The crawl targets. Adding a site = one more object here plus a table layout the
// "Parse lender tables" node understands (header: Bank/Lender | Interest Rate | ...).
// `single_product`: a lender's OWN site, one product per page, so the page is both the list
// and the detail page (no table of lenders). Official-site data is the most authoritative.
// NOTE: policybazaar.com/personal-loan/* redirects to paisabazaar.com (same group), so it
// is not a distinct source and is deliberately not listed.
return [
  { json: { source_site: 'paisabazaar', list_url: 'https://www.paisabazaar.com/personal-loan/interest-rates/' } },
  { json: { source_site: 'bankbazaar', list_url: 'https://www.bankbazaar.com/personal-loan.html' } },
  {
    json: {
      source_site: 'bajajfinserv',
      list_url: 'https://www.bajajfinserv.in/personal-loan',
      single_product: 'Bajaj Finance Personal Loan',
    },
  },
];
