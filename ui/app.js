/* LoanMatch UI: a dependency-free single-page app (hash routing). All data comes from the web API
 * (lambdas/api) and the existing upload endpoint; every value is inserted with textContent, never innerHTML,
 * so nothing from the database or the lender websites can inject markup. */
(() => {
  'use strict';

  const CFG = window.CONFIG || {};
  const API = (CFG.API_URL || localStorage.getItem('lm_api') || '').replace(/\/$/, '');
  const app = document.getElementById('app');

  // ------------------------------------------------------------------ tiny DOM helpers
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  const svg = (path, size = 28) => {
    const w = document.createElement('span');
    w.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`; // static icon markup only
    return w.firstChild;
  };
  const ICON = {
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>', rate: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>', mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 8l9 6 9-6"/>',
    check: '<path d="M5 13l4 4L19 7"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  };
  const fmt = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN');
  const pct = (r) => (r == null ? '–' : Number(r).toFixed(2) + '%');
  const ageRange = (lo, hi) => (lo && hi ? `${lo} to ${hi}` : lo ? `${lo}+` : hi ? `up to ${hi}` : '–');
  const palette = ['#295BEE', '#12296B', '#0a8a43', '#7c3aed', '#c2410c', '#0e7490', '#be185d', '#4d7c0f'];
  const colourFor = (s) => palette[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % palette.length];
  const initials = (s) => s.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  let toastTimer;
  function toast(msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, 3800);
  }

  // ------------------------------------------------------------------ API client
  const key = () => CFG.API_KEY || localStorage.getItem('lm_key') || '';
  async function api(path, { method = 'GET', body, auth = false } = {}) {
    if (!API) throw new Error('The API address is not configured. Run scripts/write_ui_config.sh, or set it under Console > Settings.');
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth) headers['x-api-key'] = key();
    let res;
    try { res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('Cannot reach the server. Check your connection and the API address.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { localStorage.removeItem('lm_key'); throw Object.assign(new Error('That access key was not accepted.'), { unauthorized: true }); }
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  // ------------------------------------------------------------------ shared UI pieces
  const skeletons = (n) => Array.from({ length: n }, () => h('div', { class: 'skeleton' }));
  const errorBox = (msg) => h('div', { class: 'error', role: 'alert' }, msg);
  const lenderCard = (l) => h('div', { class: 'lender' },
    h('div', { class: 'avatar', style: `background:${colourFor(l.lender)}` }, initials(l.lender)),
    h('div', null, h('b', null, l.lender), h('small', null, l.types ? l.types.map((t) => t === 'Self-Employed' ? 'Self-emp.' : t).join(' · ') : '')),
    h('div', { class: 'rate' }, pct(l.rate), h('small', null, 'starting p.a.')));

  function scoreChip(o, score) {
    if (o.score_flag) return h('span', { class: 'chip warn' }, `Check score: ${o.score_floor_any} needed for other applicants`);
    if (o.score_floor_own != null) return h('span', { class: 'chip ok' }, `Your score meets the ${o.score_floor_own} minimum`);
    if (o.score_floor_any != null) return h('span', { class: 'chip' }, `No minimum stated for you (others: ${o.score_floor_any})`);
    return h('span', { class: 'chip' }, 'No minimum score published');
  }
  function offerCard(o, score) {
    const note = o.caveat ? h('div', { class: 'note' }, h('b', null, 'Good to know: '), o.caveat)
      : h('div', { class: 'note' }, o.verdict === 'eligible' ? 'No extra conditions found.' : 'Final approval rests with the lender.');
    return h('article', { class: 'offer' + (o.match_rank === 1 ? ' top' : '') },
      h('div', { class: 'rank', 'aria-label': `Rank ${o.match_rank}` }, String(o.match_rank)),
      h('div', null, h('h3', null, o.lender), h('div', { class: 'chips' }, scoreChip(o, score),
        o.verdict === 'conditional' ? h('span', { class: 'chip warn' }, 'Conditions apply') : h('span', { class: 'chip ok' }, 'Rules matched')), note),
      h('div', { class: 'rate' }, pct(o.rate), h('small', null, 'starting rate p.a.')));
  }

  // ------------------------------------------------------------------ pages
  const FAQ = [
    ['How are the matches decided?', 'Each lender’s published criteria (income, credit score, age, employment type) are turned into rules and checked exactly in SQL. The LLM is only used to read lender web pages once, never to decide who qualifies.'],
    ['Why does a match say “check score”?', 'Some lenders publish a minimum score for one applicant type and say nothing for another. We never treat silence as permission: those matches are flagged and ranked behind the sure ones.'],
    ['Are these rates final?', 'No. They are the lowest published “starting” rates from lender websites. Your actual offer depends on your profile, and every lender makes its own final decision.'],
    ['Does checking offers affect my credit score?', 'No. This tool never contacts a credit bureau; it only compares what you type with public lender criteria.'],
    ['Who receives the emails?', 'In this deployment mail goes only to verified test inboxes, never to the addresses in an uploaded CSV.'],
  ];

  async function home() {
    app.replaceChildren(
      h('section', { class: 'hero' },
        h('span', { class: 'eyebrow' }, h('i'), 'One platform for every loan match'),
        h('h1', null, 'Every lender. ', h('em', null, 'One click.')),
        h('p', { class: 'lead' }, 'Upload your customers once. We read the lenders’ own criteria, rank the best personal-loan offers for each person, and email them. No manual comparison.'),
        h('div', { class: 'hero-actions' }, h('a', { class: 'btn btn-navy', href: '#/check' }, 'Check my offers →'), h('a', { class: 'btn btn-outline', href: '#/console' }, 'Upload a CSV')),
        h('div', { class: 'trust' }, ...['Rates read from lender sites', 'Honest credit-score checks', 'Exact rules, not guesses'].map((t) => h('span', null, svg(ICON.check, 16), t))),
        h('div', { class: 'stats', id: 'heroStats' },
          ...[['10,000', 'customers matched'], ['~17 s', 'to match them all'], ['0', 'LLM calls per customer'], ['Top 5', 'offers each']].map(([b, s]) => h('div', { class: 'stat' }, h('b', null, b), h('span', null, s))))),
      h('section', { class: 'section', id: 'features' },
        h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, h('i'), 'What you get'), h('h2', null, 'Everything a loan marketplace needs'), h('p', null, 'From a raw CSV to a ranked inbox offer, fully automated.')),
        h('div', { class: 'grid-4' },
          [['bolt', 'Instant matching', 'Thousands of customers matched in seconds with set-based SQL.', 'Fast', ''], ['rate', 'Lowest published rate', 'Every bank’s best advertised rate across sources, ranked first.', 'Best rates', 'navy'],
           ['shield', 'Honest score checks', 'Missing minimums are flagged, never assumed away.', 'Trusted', ''], ['mail', 'Offers by email', 'One tidy email per customer with their top 5 lenders.', 'Automated', 'navy']]
            .map(([i, t, d, tag, cls]) => h('div', { class: 'card feature' }, h('span', { class: 'tag ' + cls }, tag), h('div', { class: 'ico' }, svg(ICON[i], 30)), h('h3', null, t), h('p', null, d))))),
      h('section', { class: 'section', id: 'offers' },
        h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, h('i'), 'Live lender data'), h('h2', null, 'Today’s lowest starting rates'), h('p', null, 'Straight from the lender catalogue the matching engine uses.')),
        h('div', { class: 'offer-grid', id: 'homeLenders' }, ...skeletons(6)),
        h('div', { class: 'hero-actions', style: 'margin-top:28px' }, h('a', { class: 'btn btn-outline', href: '#/lenders' }, 'See all lenders'))),
      h('section', { class: 'section', id: 'how' },
        h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, h('i'), 'Process'), h('h2', null, 'Your loan search in 4 simple steps')),
        h('div', { class: 'steps' }, [['Upload', 'Drop a CSV of customers: income, score, age and employment type.'], ['We read the lenders', 'Public rate cards and eligibility pages are crawled and turned into exact rules.'],
          ['Match & rank', 'Every customer is matched in SQL and ranked by rate, with score checks.'], ['Get offers', 'Each customer receives their top 5 by email; you see it all in the console.']]
          .map(([t, d], i) => h('div', { class: 'step' }, h('div', { class: 'n' }, '0' + (i + 1)), h('h3', null, t), h('p', null, d))))),
      h('section', { class: 'section', id: 'why' },
        h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, h('i'), 'Why choose us'), h('h2', null, 'We compare, so you don’t have to'), h('p', null, 'The gap between the highest and the lowest published starting rate, from live data.')),
        h('div', { class: 'card compare', id: 'compare' }, ...skeletons(1))),
      h('section', { class: 'section', id: 'faq' },
        h('div', { class: 'section-head' }, h('span', { class: 'eyebrow' }, h('i'), 'Support'), h('h2', null, 'Frequently asked questions')),
        h('div', { class: 'faq' }, FAQ.map(([q, a]) => h('details', null, h('summary', null, q), h('p', null, a))))));
    try {
      const { lenders } = await api('/lenders');
      const rated = lenders.filter((l) => l.rate != null);
      if (!rated.length) throw new Error('No lender data yet. Run the crawl and a matching batch first.');
      document.getElementById('homeLenders').replaceChildren(...rated.slice(0, 6).map(lenderCard));
      const hi = rated[rated.length - 1], lo = rated[0], mid = rated[Math.floor(rated.length / 2)];
      const max = Number(hi.rate);
      const bar = (label, r, best) => h('div', { class: 'bar' + (best ? ' best' : '') }, h('span', null, label),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(r / max) * 100}%` })), h('b', null, pct(r)));
      document.getElementById('compare').replaceChildren(bar(hi.lender, hi.rate), bar(mid.lender, mid.rate), bar(lo.lender, lo.rate, true),
        h('div', { class: 'badge-best' }, h('span', null, `Best rate found: ${lo.lender} at ${pct(lo.rate)}`)));
    } catch (e) {
      document.getElementById('homeLenders').replaceChildren(errorBox(e.message));
      document.getElementById('compare').replaceChildren(errorBox(e.message));
    }
  }

  function check() {
    let etype = 'Salaried';
    const out = h('div', { class: 'results', id: 'checkOut' });
    const num = (id, label, ph, min, max, hint) => h('label', { class: 'field', for: id }, label,
      h('input', { class: 'input', id, type: 'number', inputmode: 'numeric', min, max, placeholder: ph, required: true }), hint && h('span', { class: 'hint' }, hint));
    const pills = h('div', { class: 'pills', role: 'group', 'aria-label': 'Employment type' },
      ['Salaried', 'Self-Employed', 'Business'].map((t) => h('button', { type: 'button', class: 'pill', 'aria-pressed': String(t === etype),
        onclick: (e) => { etype = t; pills.querySelectorAll('.pill').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); } }, t)));
    const form = h('form', { class: 'card form-card', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const v = (id) => document.getElementById(id).value;
      out.replaceChildren(...skeletons(3));
      try {
        const body = { monthly_income: v('inc'), credit_score: v('scr'), age: v('age'), employment_status: etype };
        const r = await api('/match', { method: 'POST', body });
        out.replaceChildren(...(r.offers.length
          ? [h('h2', { style: 'font-size:1.6rem;color:var(--navy)' }, `Your top ${r.offers.length} offers`), ...r.offers.map((o) => offerCard(o, r.input.credit_score))]
          : [h('div', { class: 'empty' }, 'No lender’s published criteria match this profile yet. Try adjusting the details.')]));
        out.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) { out.replaceChildren(errorBox(err.message)); }
    } },
      h('div', { class: 'fields' }, num('inc', 'Monthly income (₹)', '60000', 0, 10000000, 'Net monthly income'), num('scr', 'Credit score', '700', 300, 900, 'CIBIL-style score, 300 to 900'), num('age', 'Age', '35', 18, 100, 'Years, 18 to 100')),
      h('div', { class: 'field' }, h('span', { style: 'font-size:.85rem;font-weight:500;color:var(--navy)' }, 'Employment type'), pills),
      h('button', { class: 'btn btn-navy', type: 'submit', style: 'justify-self:start' }, 'Find my offers →'));
    app.replaceChildren(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('span', { class: 'eyebrow' }, h('i'), 'Instant eligibility'), h('h1', null, 'Check your offers in seconds'), h('p', null, 'No documents and no credit-bureau pull. We compare your details with every lender’s published criteria and rank the best matches.')),
      form, out));
  }

  async function lendersPage() {
    const body = h('tbody');
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Search a lender', 'aria-label': 'Search lenders' });
    let all = [];
    const render = () => {
      const term = q.value.trim().toLowerCase();
      body.replaceChildren(...all.filter((l) => l.lender.toLowerCase().includes(term)).map((l) => h('tr', null,
        h('td', null, h('b', null, l.lender), h('div', { class: 'hint' }, l.source_site)), h('td', { class: 'num' }, pct(l.rate)),
        h('td', null, (l.types || []).join(', ')), h('td', null, l.min_credit_score ? String(l.min_credit_score) : 'Not published'),
        h('td', null, ageRange(l.min_age, l.max_age)))));
    };
    q.addEventListener('input', render);
    app.replaceChildren(h('div', { class: 'page' },
      h('div', { class: 'page-head' }, h('span', { class: 'eyebrow' }, h('i'), 'Lender catalogue'), h('h1', null, 'Every lender we compare'), h('p', null, 'One record per bank, at the lowest starting rate any source publishes. Criteria shown are the loosest across applicant types.')),
      h('div', { class: 'search' }, q), h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['Lender', 'From (p.a.)', 'Accepts', 'Min. score', 'Age range'].map((c) => h('th', null, c)))), body))));
    try { all = (await api('/lenders')).lenders; render(); } catch (e) { body.replaceChildren(h('tr', null, h('td', { colspan: 5 }, errorBox(e.message)))); }
  }

  // ------------------------------------------------------------------ console
  const PIPE = [['Uploaded', 'CSV stored in S3'], ['Loaded', 'Rows validated and saved'], ['Matched', 'Top 5 ranked per customer'], ['Notes ready', 'Lender conditions attached'], ['Emailed', 'Offers sent to test inboxes']];
  function pipelineStage(s) {
    const b = s && s.latest_batch; if (!b) return -1;
    if (b.status === 'pending') return 0; if (b.status === 'processing') return 1;
    if (b.status === 'processed' || b.status === 'matching') return 2;
    if (b.status === 'matched') return s.emails_sent_for_batch > 0 ? 5 : 3;
    return -1;
  }
  const stepper = (stage) => h('div', { class: 'stepper' }, PIPE.map(([t, d], i) => h('div', { class: 'stp' + (i < stage ? ' done' : i === stage ? ' active' : '') },
    h('div', { class: 'dot' }, i < stage ? '✓' : String(i + 1)), h('div', null, h('b', null, t), h('small', null, d)))));

  async function consolePage(tab) {
    if (!key()) { askKey(() => consolePage(tab)); app.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'empty' }, 'The console is locked. Enter the access key to continue.'))); return; }
    const panel = h('div');
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, [['overview', 'Overview'], ['upload', 'Upload'], ['customers', 'Customers']].map(([id, label]) =>
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { location.hash = '#/console/' + id; } }, label)));
    app.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('span', { class: 'eyebrow' }, h('i'), 'Console'), h('h1', null, 'Pipeline console'),
      h('p', null, 'Upload customers, watch the pipeline run, and inspect any customer’s offers.')), tabs, panel));
    try {
      if (tab === 'upload') await uploadTab(panel); else if (tab === 'customers') customersTab(panel); else await overviewTab(panel);
    } catch (e) { if (e.unauthorized) { askKey(() => consolePage(tab)); } panel.replaceChildren(errorBox(e.message)); }
  }

  async function overviewTab(panel) {
    const s = await api('/summary', { auth: true });
    const st = (s.latest_batch && s.latest_batch.match_stats) || {};
    const rows = [['Every customer × every lender record', st.pairs_naive], ['After merging duplicate lenders', st.pairs_after_reconcile], ['After the SQL envelope filter', st.pairs_after_stage1_envelope],
      ['After exact per-type rules', st.pairs_after_stage2_exact_rules], ['Kept: top 5 per customer', st.matches_written]];
    const top = Math.max(1, ...rows.map((r) => r[1] || 0));
    const notesPct = s.notes.total ? Math.round((100 * s.notes.current) / s.notes.total) : 0;
    panel.replaceChildren(
      h('div', { class: 'kpis' }, ...[[fmt(s.totals.users), 'customers loaded'], [fmt(s.totals.matches), 'offers ranked'], [fmt(s.totals.lenders), 'lenders compared'], [notesPct + '%', 'lender notes current'], [fmt(s.emails_sent_for_batch), 'emails sent (latest batch)']]
        .map(([b, l]) => h('div', { class: 'kpi' }, h('b', null, b), h('span', null, l)))),
      h('div', { class: 'two' },
        h('div', { class: 'card' }, h('h3', { style: 'font-size:1.3rem;color:var(--navy)' }, 'Latest batch'), h('p', { class: 'hint' }, s.latest_batch ? `${s.latest_batch.batch_id}` : 'No uploads yet.'), stepper(pipelineStage(s))),
        h('div', { class: 'card funnel' }, h('h3', { style: 'font-size:1.3rem;color:var(--navy);margin-bottom:6px' }, 'How the work shrinks'),
          ...(st.pairs_naive ? rows.map(([l, n]) => h('div', { class: 'row' }, h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${((n || 0) / top) * 100}%` }), h('span', { class: 'lab' }, l)), h('div', { class: 'num' }, fmt(n))))
            : [h('p', { class: 'hint' }, 'Upload a CSV to see the funnel.')]),
          st.llm_calls_in_this_workflow === 0 ? h('p', { class: 'hint' }, 'LLM calls while matching: 0. The LLM only reads lender pages, once.') : null)));
  }

  async function uploadTab(panel) {
    const input = h('input', { type: 'file', accept: '.csv,text/csv', class: 'sr-only', id: 'csvFile' });
    const bar = h('progress', { max: 100, value: 0, style: 'display:none' });
    const status = h('div', { class: 'hint', style: 'margin-top:12px', 'aria-live': 'polite' });
    const live = h('div', { class: 'card' }, h('h3', { style: 'font-size:1.3rem;color:var(--navy)' }, 'Pipeline progress'), h('div', { id: 'liveStepper' }, stepper(-1)));
    const drop = h('label', { class: 'drop', for: 'csvFile' }, svg(ICON.upload, 36), h('div', null, h('b', null, 'Drop a CSV here or click to browse')), h('p', null, 'user_id, name, email, monthly_income, credit_score, employment_status, age'));
    ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) startUpload(e.dataTransfer.files[0]); });
    input.addEventListener('change', () => input.files[0] && startUpload(input.files[0]));

    async function startUpload(file) {
      if (!file.name.toLowerCase().endsWith('.csv')) { toast('Please choose a .csv file', true); return; }
      bar.style.display = 'block'; bar.value = 0; status.textContent = 'Requesting a secure upload link…';
      try {
        const info = await api('/upload-url', { method: 'POST', body: { filename: file.name }, auth: true });
        if (file.size > info.max_bytes) throw new Error(`File is larger than the ${info.max_bytes / 1048576} MB limit.`);
        const form = new FormData(); Object.entries(info.fields).forEach(([k, v]) => form.append(k, v)); form.append('file', file);
        await new Promise((resolve, reject) => {
          const x = new XMLHttpRequest(); x.open('POST', info.upload_url);
          x.upload.onprogress = (e) => { if (e.lengthComputable) { bar.value = (e.loaded / e.total) * 100; status.textContent = `Uploading… ${Math.round(bar.value)}%`; } };
          x.onload = () => (x.status >= 200 && x.status < 300 ? resolve() : reject(new Error(`Upload was rejected (HTTP ${x.status})`)));
          x.onerror = () => reject(new Error('Network error during upload')); x.send(form);
        });
        bar.value = 100; status.textContent = `Uploaded. Batch ${info.batch_id} is being processed.`; toast('Upload complete. Pipeline started.');
        watch(info.batch_id);
      } catch (e) { status.textContent = ''; toast(e.message, true); }
    }
    let timer;
    async function watch(batchId) {
      clearInterval(timer);
      const tick = async () => {
        try {
          const s = await api('/summary', { auth: true });
          if (!document.getElementById('liveStepper')) { clearInterval(timer); return; }
          const mine = s.recent_batches.find((b) => b.batch_id === batchId);
          const stage = !mine ? 0 : pipelineStage({ latest_batch: mine, emails_sent_for_batch: mine.batch_id === s.latest_batch.batch_id ? s.emails_sent_for_batch : 0 });
          document.getElementById('liveStepper').replaceChildren(stepper(stage));
          if (mine && mine.status === 'matched' && Number(mine.row_count) === 0) {
            // Every user_id in the file already exists (inserts skip duplicates), so nothing new was matched or emailed.
            clearInterval(timer); status.textContent = 'This file added no new customers: every user_id is already in the database, so there was nothing to match.'; toast('No new customers in this file.', true); return;
          }
          if (stage >= 5 || (mine && ['failed', 'webhook_failed'].includes(mine.status))) { clearInterval(timer); if (stage >= 5) toast('Done: offers were emailed.'); }
        } catch { /* transient: try again on the next tick */ }
      };
      await tick(); timer = setInterval(tick, 3000);
      window.addEventListener('hashchange', () => clearInterval(timer), { once: true });
    }
    panel.replaceChildren(h('div', { class: 'two' }, h('div', { class: 'card' }, h('h3', { style: 'font-size:1.3rem;color:var(--navy);margin-bottom:14px' }, 'Upload customers'), input, drop, bar, status), live));
  }

  function customersTab(panel) {
    const list = h('div', { class: 'people' }), detail = h('div');
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Search a customer by name or paste a user id', 'aria-label': 'Search customers' });
    async function search() {
      const term = q.value.trim(); if (term.length < 2) { toast('Type at least 2 characters', true); return; }
      try {
        const { users } = await api('/users?q=' + encodeURIComponent(term), { auth: true });
        list.replaceChildren(...(users.length ? users.map((u) => h('button', { class: 'person', 'aria-pressed': 'false', onclick: (e) => { list.querySelectorAll('.person').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); open(u.user_id); } },
          u.name, h('small', null, [u.employment_status, u.monthly_income != null ? inr(u.monthly_income) : null, u.credit_score != null ? 'score ' + u.credit_score : null, u.age != null ? 'age ' + u.age : null].filter(Boolean).join(' · ')))) : [h('div', { class: 'empty' }, 'No customer matches that search.')]));
        if (users.length === 1) { list.firstChild.click(); }
      } catch (e) { list.replaceChildren(errorBox(e.message)); }
    }
    async function open(id) {
      detail.replaceChildren(...skeletons(2));
      try {
        const d = await api('/users/' + id, { auth: true }), u = d.user;
        const sent = d.offers.some((o) => o.notified_at);
        detail.replaceChildren(h('div', { class: 'profile' }, h('h3', null, u.name), h('span', { class: 'chip' }, u.employment_status), h('span', { class: 'chip' }, inr(u.monthly_income) + '/month'),
          h('span', { class: 'chip' }, 'Score ' + u.credit_score), h('span', { class: 'chip' }, 'Age ' + u.age),
          d.test_inbox ? h('span', { class: 'chip ' + (sent ? 'ok' : 'warn') }, (sent ? 'Emailed to ' : 'Test inbox ') + d.test_inbox) : h('span', { class: 'chip' }, 'Not a test recipient: no email is sent')),
          h('div', { class: 'results', style: 'margin-top:0' }, ...(d.offers.length ? d.offers.map((o) => offerCard(o, u.credit_score)) : [h('div', { class: 'empty' }, 'No stored offers for this customer.')])));
      } catch (e) { detail.replaceChildren(errorBox(e.message)); }
    }
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
    panel.replaceChildren(h('div', { class: 'search' }, q, h('button', { class: 'btn btn-navy', onclick: search }, 'Search')), list, detail);
  }

  // ------------------------------------------------------------------ access key dialog
  const dlg = document.getElementById('keyDialog');
  function askKey(done) {
    if (dlg.open) return;
    dlg.showModal();
    document.getElementById('keyForm').onsubmit = () => { localStorage.setItem('lm_key', document.getElementById('keyInput').value.trim()); setTimeout(done, 0); };
    document.getElementById('keyCancel').onclick = () => dlg.close();
  }

  // ------------------------------------------------------------------ router
  function route() {
    const [, path = '', sub] = location.hash.replace(/^#\/?/, '#/').split('/');
    const page = path.replace('#', '') ;
    document.querySelectorAll('.nav a[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === (page || 'home')));
    window.scrollTo({ top: 0 });
    if (page === 'check') check();
    else if (page === 'lenders') lendersPage();
    else if (page === 'console') consolePage(sub || 'overview');
    else {
      home().then(() => { const anchor = location.hash.split('#')[2]; if (anchor) document.getElementById(anchor)?.scrollIntoView(); });
    }
    app.focus({ preventScroll: true });
  }
  document.querySelectorAll('[data-scroll]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const go = () => document.getElementById(a.dataset.scroll)?.scrollIntoView({ behavior: 'smooth' });
    if (location.hash && location.hash !== '#/' && location.hash !== '#') { location.hash = '#/'; setTimeout(go, 400); } else go();
  }));
  window.addEventListener('hashchange', route);
  route();
})();
