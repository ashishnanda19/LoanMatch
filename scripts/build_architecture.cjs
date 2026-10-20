#!/usr/bin/env node
/**
 * Draws the architecture diagram in the hand-drawn "Excalidraw" style, with service logos, from ONE layout
 * description, and writes two outputs so they can never drift apart:
 *
 *   docs/architecture.excalidraw   editable in https://excalidraw.com  (File -> Open); every box, its logos and its
 *                                  text are grouped, so they move together
 *   docs/architecture.svg          what the README shows (the PNG is rendered from it)
 *
 * Usage:  npm i roughjs   &&   node scripts/build_architecture.cjs
 * PNG:    chrome --headless=new --force-device-scale-factor=2 --window-size=1600,1300 \
 *              --screenshot=docs/architecture.png docs/architecture.svg
 *
 * The Mermaid version of the same diagram stays in docs/architecture.mmd and in the README.
 * Logos live in docs/icons/ (trademarks of their owners; used only to identify the services).
 */
const fs = require('fs');
const path = require('path');
const rough = require('roughjs/bundled/rough.cjs.js');

const ROOT = path.resolve(__dirname, '..');
const W = 1600, H = 1300;
const C = { bg: '#161616', ink: '#ececec', mute: '#a8aeb4', frame: '#4a4a4a', box: '#1f1f1f',
  orange: '#f59e0b', green: '#22c55e', cyan: '#06b6d4', purple: '#a78bfa', blue: '#4a9eed' };
const FILL = { orange: '#2a2010', green: '#10301d', cyan: '#0e2a30', purple: '#241c3d', blue: '#12263d', ink: C.box };
const T = 26, S = 22, LBL = 22, LEG = 20;   // title, subtitle, arrow-label, legend font sizes

// ------------------------------------------------------------------ icons
const ICON_DIR = path.join(ROOT, 'docs/icons');
function loadIcon(file, h, crop) {
  let svg = fs.readFileSync(path.join(ICON_DIR, file), 'utf8');
  if (crop) svg = svg.replace(/viewBox="[^"]*"/, `viewBox="${crop}"`);
  const vb = svg.match(/viewBox="([\d.\s-]+)"/)[1].split(/\s+/).map(Number);
  const w = Math.round(h * vb[2] / vb[3]);
  svg = svg.replace(/(<svg[^>]*?)\swidth="[^"]*"/, '$1').replace(/(<svg[^>]*?)\sheight="[^"]*"/, '$1')
    .replace('<svg', `<svg width="${w}" height="${h}"`);
  return { w, h, dataUrl: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
}
const ICONS = {
  chrome: loadIcon('chrome.svg', 56), apigw: loadIcon('aws-api-gateway.svg', 52), lambda: loadIcon('aws-lambda.svg', 52),
  s3: loadIcon('aws-s3.svg', 56), rds: loadIcon('aws-rds.svg', 64), pg: loadIcon('postgresql.svg', 64),
  n8n: loadIcon('n8n.svg', 36, '0 0 300 143'), gemini: loadIcon('google-gemini.svg', 46, '322 2 68 68'), ses: loadIcon('aws-ses.svg', 46),
  gmail: loadIcon('google-gmail.svg', 40),
};

// ------------------------------------------------------------------ layout (scene units)
// lines = [title, subtitle, ...]; icons are drawn at the left (centred on top for `top` boxes)
const boxes = [
  { id: 'client', x: 30, y: 70, w: 370, h: 100, c: 'ink', icons: ['chrome'], lines: ['LoanMatch web UI', 'Upload · offers · console'] },
  { id: 'apigw', x: 1110, y: 70, w: 460, h: 100, c: 'orange', icons: ['apigw', 'lambda'], lines: ['API Gateway', '+ Lambdas: upload, web API'] },
  { id: 's3', x: 30, y: 240, w: 370, h: 100, c: 'orange', icons: ['s3'], lines: ['Amazon S3', 'CSV uploads (presigned)'] },
  { id: 'l2', x: 540, y: 240, w: 370, h: 100, c: 'orange', icons: ['lambda'], lines: ['Lambda: parse-csv', 'VPC · streamed insert'] },
  { id: 'rds', x: 1280, y: 230, w: 290, h: 740, c: 'cyan', top: true, icons: ['rds', 'pg'],
    lines: ['Amazon RDS', 'PostgreSQL 16', '', 'users', 'loan_products', 'matches', 'qualitative_reviews', 'test_recipients'] },
  { id: 'src1', x: 30, y: 412, w: 370, h: 50, c: 'blue', one: true, lines: ['Paisabazaar'] },
  { id: 'src2', x: 30, y: 472, w: 370, h: 50, c: 'blue', one: true, lines: ['BankBazaar'] },
  { id: 'src3', x: 30, y: 532, w: 370, h: 50, c: 'blue', one: true, lines: ['Bajaj Finserv (official)'] },
  { id: 'A', x: 30, y: 650, w: 370, h: 120, c: 'green', t: 24, icons: ['n8n'], lines: ['Workflow A', 'Loan Product Discovery', 'Crawl + rule extraction'] },
  { id: 'llm', x: 30, y: 830, w: 370, h: 110, c: 'purple', t: 24, icons: ['gemini'], lines: ['LLM providers', 'Groq · Gemini fallback'] },
  { id: 'E', x: 30, y: 1010, w: 370, h: 120, c: 'green', t: 24, icons: ['n8n'], lines: ['Workflow E', 'Failure Alerts', 'Mails owner on failure'] },
  { id: 'B', x: 540, y: 650, w: 370, h: 120, c: 'green', t: 24, icons: ['n8n'], lines: ['Workflow B', 'User–Loan Matching', 'SQL pipeline · ~17 s'] },
  { id: 'R', x: 540, y: 830, w: 370, h: 120, c: 'green', t: 24, icons: ['n8n'], lines: ['Workflow R', 'Lender Notes', 'Cached LLM notes'] },
  { id: 'C', x: 540, y: 1010, w: 370, h: 120, c: 'green', t: 24, icons: ['n8n'], lines: ['Workflow C', 'Match Notifications', 'One email per user'] },
  { id: 'ses', x: 1000, y: 1070, w: 250, h: 100, c: 'orange', icons: ['ses'], lines: ['Amazon SES', 'Sandbox'] },
  { id: 'inbox', x: 1310, y: 1070, w: 260, h: 100, c: 'blue', icons: ['gmail'], lines: ['Test inboxes', '+one / +two'] },
];
const texts = [
  { id: 'src', x: 30, y: 372, s: S, color: 'mute', text: 'Public sources' },
  { id: 'l1', x: 560, y: 66, s: LBL, text: '1  Request upload URL' },
  { id: 'l2', x: 560, y: 148, s: LBL, text: '2  Presigned POST URL' },
  { id: 'l3', x: 231, y: 188, s: LBL, text: '3  Upload CSV' },
  { id: 'l4', x: 408, y: 252, s: LBL, text: '4  S3 event' },
  { id: 'l5', x: 990, y: 252, s: LBL, text: '5  Insert users' },
  { id: 'l6', x: 741, y: 480, s: LBL, text: '6  Webhook (secret header)' },
  { id: 'l7', x: 940, y: 672, s: LBL, text: '7  Filter · rank · top 5' },
  { id: 'l8', x: 741, y: 792, s: LBL, text: '8  Lender notes (waits)' },
  { id: 'l9', x: 741, y: 968, s: LBL, text: '9  Then notify' },
  { id: 'l10', x: 930, y: 1004, s: LBL, text: '10  Read matches + notes' },
  { id: 'l11', x: 916, y: 1058, s: LBL, text: '11 Send' },
  { id: 'lsave', x: 1040, y: 852, s: LBL, text: 'Save notes' },
  { id: 'lcrawl', x: 231, y: 600, s: LBL, text: 'Crawl' },
  { id: 'lextract', x: 231, y: 788, s: LBL, text: 'Extract rules' },
  { id: 'lannot', x: 412, y: 868, s: 20, text: 'Annotate' },
  { id: 'n8ncap1', x: 940, y: 540, s: S, color: 'green', text: 'Workflows A, B, R, C and E' },
  { id: 'n8ncap2', x: 940, y: 570, s: S, color: 'green', text: 'run in n8n on EC2 (Docker)' },
  { id: 'leg1', x: 30, y: 1190, s: LEG, color: 'mute', text: 'Thin arrow: data flow  ·  Thick arrow: workflow hand-off  ·  Dashed: after every crawl, all lenders are reviewed' },
  { id: 'leg2', x: 30, y: 1222, s: LEG, color: 'mute', text: 'Green: n8n workflow  ·  Orange: AWS  ·  Purple: external LLM  ·  Blue: people and public web' },
];
// pts are absolute scene coordinates; dash = dashed; thick = workflow hand-off; both = arrowheads at both ends
const arrows = [
  { id: 'a1', pts: [[400, 105], [1110, 105]] },
  { id: 'a2', pts: [[1110, 140], [400, 140]] },
  { id: 'a3', pts: [[215, 170], [215, 240]] },
  { id: 'a4', pts: [[400, 290], [540, 290]] },
  { id: 'a5', pts: [[910, 290], [1280, 290]] },
  { id: 'a6', pts: [[725, 340], [725, 650]] },
  { id: 'a7', pts: [[910, 710], [1280, 710]], both: true },
  { id: 'a8', pts: [[725, 770], [725, 830]], thick: true },
  { id: 'a9', pts: [[725, 950], [725, 1010]], thick: true },
  { id: 'a10', pts: [[910, 1040], [1425, 1040], [1425, 970]] },
  { id: 'a11', pts: [[910, 1100], [1000, 1100]] },
  { id: 'a12', pts: [[1250, 1120], [1310, 1120]] },
  { id: 'asave', pts: [[910, 890], [1280, 890]] },
  { id: 'acrawl', pts: [[215, 582], [215, 650]] },
  { id: 'aextract', pts: [[215, 770], [215, 830]] },
  { id: 'aafter', pts: [[400, 710], [470, 710], [470, 858], [540, 858]], dash: true },
  { id: 'allm', pts: [[540, 905], [400, 905]], both: true },
];

// ------------------------------------------------------------------ helpers
const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const colorOf = (k) => C[k] || C.ink;
const strokeOf = (b) => (b.c === 'ink' ? C.ink : colorOf(b.c));
const LINE = 1.25;
const textW = (t, size) => Math.ceil(t.length * size * 0.52);
const sizesOf = (b) => b.lines.map((_, i) => (i === 0 ? (b.t || (b.one ? 26 : T)) : S));
const ICON_GAP = 10, ICON_PAD = 18;

// where do a box's icons and text go?
function geometry(b) {
  const icons = (b.icons || []).map((k) => ICONS[k]);
  if (b.top) {   // tall box: icons centred on top, text below
    const total = icons.reduce((n, i) => n + i.w, 0) + ICON_GAP * (icons.length - 1);
    let x = b.x + (b.w - total) / 2;
    const placed = icons.map((icon, n) => { const o = { icon, key: b.icons[n], x, y: b.y + 22 }; x += icon.w + ICON_GAP; return o; });
    return { placed, cx: b.x + b.w / 2, top: b.y + 22 + Math.max(...icons.map((i) => i.h)) + 20, topAligned: true };
  }
  let x = b.x + ICON_PAD;
  const placed = icons.map((icon, n) => { const o = { icon, key: b.icons[n], x, y: b.y + (b.h - icon.h) / 2 }; x += icon.w + ICON_GAP; return o; });
  const left = icons.length ? x - ICON_GAP + 14 : b.x;
  return { placed, cx: left + (b.x + b.w - left) / 2, topAligned: false };
}
function textTop(b, g, sizes) {
  const block = sizes.reduce((n, s) => n + s * LINE, 0);
  return g.topAligned ? g.top : b.y + (b.h - block) / 2;
}

// ------------------------------------------------------------------ SVG
const gen = rough.generator();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const roundedPath = (x, y, w, h, r) =>
  `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} ` +
  `L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
const pathsToSvg = (drawable) =>
  gen.toPaths(drawable).map((p) =>
    `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || 'none'}"` +
    `${drawable.options.strokeLineDash ? ` stroke-dasharray="${drawable.options.strokeLineDash.join(' ')}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`).join('');
const FONT = "'Inter','Helvetica Neue',Helvetica,'Segoe UI',Arial,sans-serif";
const svgLine = (text, x, baseline, size, color, anchor, weight = 400) =>
  `<text x="${x}" y="${baseline}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(text) || '&#160;'}</text>`;

function buildSvg() {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  out.push(pathsToSvg(gen.path(roundedPath(10, 10, W - 20, H - 20, 24), { stroke: C.frame, strokeWidth: 2, roughness: 0.7, seed: 11 })));
  out.push(`<rect x="26" y="20" width="560" height="46" rx="8" fill="${C.bg}"/>`);
  out.push(pathsToSvg(gen.path(roundedPath(26, 20, 560, 46, 8), { stroke: C.mute, strokeWidth: 1.5, roughness: 1, seed: 5 })));
  out.push(svgLine('Loan Eligibility Engine  ·  System Architecture', 306, 51, 24, C.ink, 'middle', 600));
  for (const b of boxes) {
    out.push(pathsToSvg(gen.path(roundedPath(b.x, b.y, b.w, b.h, 14), {
      stroke: strokeOf(b), strokeWidth: 2.4, roughness: 0.7, seed: hash(b.id), fill: FILL[b.c], fillStyle: 'solid' })));
    const g = geometry(b);
    for (const p of g.placed) out.push(`<image href="${p.icon.dataUrl}" x="${p.x}" y="${p.y}" width="${p.icon.w}" height="${p.icon.h}"/>`);
    const sizes = sizesOf(b);
    let y = textTop(b, g, sizes);
    b.lines.forEach((l, i) => {
      out.push(svgLine(l, g.cx, y + sizes[i] * 0.95, sizes[i], i === 0 ? C.ink : C.mute, 'middle', i === 0 ? 600 : 400));
      y += sizes[i] * LINE;
    });
  }
  for (const a of arrows) {
    const color = a.dash ? C.mute : C.ink;
    const opts = { stroke: color, strokeWidth: a.thick ? 4.5 : 2.2, roughness: 0.5, seed: hash(a.id) };
    if (a.dash) opts.strokeLineDash = [9, 9];
    out.push(pathsToSvg(gen.linearPath(a.pts, opts)));
    const head = (from, to) => {
      const ang = Math.atan2(to[1] - from[1], to[0] - from[0]), L = a.thick ? 24 : 17;
      return [-0.45, 0.45].map((d) => pathsToSvg(gen.line(to[0], to[1], to[0] - L * Math.cos(ang + d), to[1] - L * Math.sin(ang + d),
        { stroke: color, strokeWidth: a.thick ? 4.5 : 2.2, roughness: 0.6, seed: hash(a.id + d) }))).join('');
    };
    const n = a.pts.length;
    out.push(head(a.pts[n - 2], a.pts[n - 1]));
    if (a.both) out.push(head(a.pts[1], a.pts[0]));
  }
  for (const t of texts) out.push(svgLine(t.text, t.x, t.y + t.s * 0.95, t.s, colorOf(t.color || 'ink'), 'start'));
  out.push('</svg>');
  return out.join('\n');
}

// ------------------------------------------------------------------ Excalidraw file
let seedN = 100;
const base = (o) => ({ angle: 0, fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
  groupIds: [], frameId: null, roundness: null, seed: (seedN += 37), version: 1, versionNonce: (seedN += 11),
  isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...o });
const mkText = (id, x, y, text, size, color, extra = {}) => base({
  type: 'text', id, x, y, width: textW(text, size), height: size * LINE, strokeColor: color, backgroundColor: 'transparent',
  text, originalText: text, fontSize: size, fontFamily: 2, textAlign: 'left', verticalAlign: 'top', containerId: null,
  autoResize: true, lineHeight: LINE, ...extra });

function buildExcalidraw() {
  const els = [], files = {};
  els.push(base({ type: 'rectangle', id: 'frame', x: 10, y: 10, width: W - 20, height: H - 20, strokeColor: C.frame,
    backgroundColor: 'transparent', roundness: { type: 3 } }));
  els.push(base({ type: 'rectangle', id: 'tag', x: 26, y: 20, width: 560, height: 46, strokeColor: C.mute, strokeWidth: 1,
    backgroundColor: C.bg, roundness: { type: 3 } }));
  els.push(mkText('tagtext', 62, 30, 'Loan Eligibility Engine  ·  System Architecture', 24, C.ink));
  for (const b of boxes) {
    const grp = ['g_' + b.id];
    els.push(base({ type: 'rectangle', id: b.id, x: b.x, y: b.y, width: b.w, height: b.h, strokeColor: strokeOf(b),
      backgroundColor: FILL[b.c], roundness: { type: 3 }, groupIds: grp }));
    const g = geometry(b);
    g.placed.forEach((p, n) => {
      const fileId = 'icon_' + p.key;
      files[fileId] = { mimeType: 'image/svg+xml', id: fileId, dataURL: p.icon.dataUrl, created: 1, lastRetrieved: 1 };
      els.push(base({ type: 'image', id: `${b.id}_img${n}`, x: p.x, y: p.y, width: p.icon.w, height: p.icon.h,
        strokeColor: 'transparent', backgroundColor: 'transparent', fileId, status: 'saved', scale: [1, 1], crop: null, groupIds: grp }));
    });
    const sizes = sizesOf(b);
    let y = textTop(b, g, sizes);
    b.lines.forEach((l, i) => {
      els.push(mkText(`${b.id}_t${i}`, g.cx - textW(l, sizes[i]) / 2, y, l, sizes[i], i === 0 ? C.ink : C.mute,
        { textAlign: 'center', groupIds: grp }));
      y += sizes[i] * LINE;
    });
  }
  for (const a of arrows) {
    const [x0, y0] = a.pts[0];
    const rel = a.pts.map(([x, y]) => [x - x0, y - y0]);
    els.push(base({ type: 'arrow', id: a.id, x: x0, y: y0, width: Math.max(...rel.map((p) => Math.abs(p[0]))),
      height: Math.max(...rel.map((p) => Math.abs(p[1]))), strokeColor: a.dash ? C.mute : C.ink,
      strokeWidth: a.thick ? 4 : 2, strokeStyle: a.dash ? 'dashed' : 'solid', backgroundColor: 'transparent',
      points: rel, lastCommittedPoint: null, startBinding: null, endBinding: null,
      startArrowhead: a.both ? 'arrow' : null, endArrowhead: 'arrow', elbowed: false, roundness: { type: 2 } }));
  }
  for (const t of texts) els.push(mkText('txt_' + t.id, t.x, t.y, t.text, t.s, colorOf(t.color || 'ink')));
  return { type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: els,
    appState: { viewBackgroundColor: C.bg, gridSize: null, theme: 'dark' }, files };
}

// ------------------------------------------------------------------ write
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/architecture.svg'), buildSvg());
fs.writeFileSync(path.join(ROOT, 'docs/architecture.excalidraw'), JSON.stringify(buildExcalidraw(), null, 1));
console.log('wrote docs/architecture.svg and docs/architecture.excalidraw');
