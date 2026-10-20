#!/usr/bin/env node
/**
 * Draws the architecture diagram in the hand-drawn "Excalidraw" style from ONE layout description and
 * writes three outputs, so they can never drift apart:
 *
 *   docs/architecture.excalidraw   editable in https://excalidraw.com  (File -> Open)
 *   docs/architecture.svg          what the README shows
 *   <out>/architecture.mcp.json    (optional 2nd argument) element list for the Excalidraw MCP preview
 *
 * Usage:  npm i roughjs   &&   node scripts/build_architecture.cjs [mcp-output-dir]
 * Turn the SVG into a PNG with:  chrome --headless --screenshot=docs/architecture.png --window-size=1600,1200 docs/architecture.svg
 *
 * The Mermaid version of the same diagram stays in docs/architecture.mmd (and in the README) as a fallback.
 */
const fs = require('fs');
const path = require('path');
const rough = require('roughjs/bundled/rough.cjs.js');

const ROOT = path.resolve(__dirname, '..');
const W = 1600, H = 1200;
const C = { bg: '#161616', ink: '#ececec', mute: '#9aa0a6', frame: '#4a4a4a', box: '#1f1f1f',
  orange: '#f59e0b', green: '#22c55e', cyan: '#06b6d4', purple: '#a78bfa', blue: '#4a9eed' };
const FILL = { orange: '#2a2010', green: '#10301d', cyan: '#0e2a30', purple: '#241c3d', blue: '#12263d', ink: C.box };

// ------------------------------------------------------------------ layout (scene units)
const boxes = [
  { id: 'client', x: 60, y: 80, w: 280, h: 90, c: 'ink', lines: ['Client', 'upload page'] },
  { id: 'apigw', x: 1160, y: 80, w: 380, h: 90, c: 'orange', lines: ['API Gateway + Lambda', 'get-upload-url'] },
  { id: 's3', x: 60, y: 240, w: 260, h: 90, c: 'orange', lines: ['S3 uploads bucket', 'presigned, size-capped'] },
  { id: 'l2', x: 480, y: 240, w: 320, h: 90, c: 'orange', lines: ['Lambda parse-csv', 'in VPC, streamed insert'] },
  { id: 'rds', x: 1300, y: 230, w: 260, h: 730, c: 'cyan', top: true,
    lines: ['RDS Postgres 16', '', 'users', 'loan_products', 'matches', 'qualitative_reviews', 'test_recipients'] },
  { id: 'src1', x: 60, y: 400, w: 260, h: 46, c: 'blue', lines: ['Paisabazaar'] },
  { id: 'src2', x: 60, y: 460, w: 260, h: 46, c: 'blue', lines: ['BankBazaar'] },
  { id: 'src3', x: 60, y: 520, w: 260, h: 46, c: 'blue', lines: ['Bajaj Finserv (official)'] },
  { id: 'A', x: 50, y: 660, w: 280, h: 100, c: 'green', lines: ['A · Product Discovery', 'daily 02:00 · crawl', 'upserts loan_products'] },
  { id: 'B', x: 480, y: 660, w: 320, h: 100, c: 'green', lines: ['B · User-Loan Matching', 'SQL only · about 17 s'] },
  { id: 'R', x: 480, y: 830, w: 320, h: 100, c: 'green', lines: ['R · Lender Notes', 'cached LLM · 1 call/lender'] },
  { id: 'C', x: 480, y: 1000, w: 320, h: 100, c: 'green', lines: ['C · Match Notifications', 'one email per user'] },
  { id: 'llm', x: 50, y: 830, w: 280, h: 100, c: 'purple', lines: ['Groq (primary)', 'Gemini (fallback)'] },
  { id: 'ses', x: 900, y: 1060, w: 200, h: 80, c: 'orange', lines: ['Amazon SES', 'sandbox'] },
  { id: 'inbox', x: 1180, y: 1060, w: 300, h: 80, c: 'blue', lines: ['Test inbox', '+one / +two aliases only'] },
];
const texts = [
  { id: 'txt_srclabel', x: 60, y: 366, s: 22, color: 'mute', text: 'public sources' },
  { id: 'txt_l1', x: 560, y: 70, s: 20, text: '1  request upload URL' },
  { id: 'txt_l2', x: 560, y: 150, s: 20, text: '2  presigned POST URL' },
  { id: 'txt_l3', x: 215, y: 196, s: 20, text: '3  upload CSV straight to S3' },
  { id: 'txt_l4', x: 336, y: 250, s: 20, text: '4  S3 event' },
  { id: 'txt_l5', x: 880, y: 248, s: 20, text: '5  bulk insert users' },
  { id: 'txt_l6', x: 655, y: 470, s: 20, text: '6  POST /webhook/batch-ready' },
  { id: 'txt_l7', x: 860, y: 668, s: 20, text: '7  filter, rank, write top 5' },
  { id: 'txt_l8', x: 655, y: 782, s: 20, text: '8  notes for matched lenders (waits)' },
  { id: 'txt_l9', x: 655, y: 952, s: 20, text: '9  then notify' },
  { id: 'txt_l10', x: 840, y: 982, s: 20, text: '10  read matches + notes' },
  { id: 'txt_l11', x: 806, y: 1102, s: 20, text: '11  send' },
  { id: 'txt_lsave', x: 960, y: 848, s: 20, text: 'save notes' },
  { id: 'txt_lcrawl', x: 205, y: 598, s: 20, text: 'crawl 3 sites' },
  { id: 'txt_lextract', x: 205, y: 780, s: 20, text: 'extract rules' },
  { id: 'txt_lannot', x: 345, y: 870, s: 18, text: 'annotate' },
  { id: 'txt_lafter', x: 342, y: 668, s: 18, text: 'after a crawl:', color: 'mute' },
  { id: 'txt_lafter2', x: 342, y: 688, s: 18, text: 'all lenders', color: 'mute' },
  { id: 'txt_lN8N', x: 830, y: 588, s: 20, color: 'green', text: 'B, R, C (and A) run in n8n' },
  { id: 'txt_lN8N2', x: 830, y: 614, s: 20, color: 'green', text: 'on EC2 via docker compose' },
  { id: 'txt_legend1', x: 60, y: 1130, s: 18, color: 'mute', text: 'thin arrow = data    thick = workflow hand-off    dotted = refresh after a crawl' },
  { id: 'txt_legend2', x: 60, y: 1156, s: 18, color: 'mute', text: 'green = n8n workflow (on EC2)    orange = AWS    purple = external LLM    blue = people / public web' },
];
// pts are absolute scene coordinates; dash = dotted; thick = workflow hand-off; both = arrowheads at both ends
const arrows = [
  { id: 'a1', pts: [[340, 110], [1160, 110]] },
  { id: 'a2', pts: [[1160, 145], [340, 145]] },
  { id: 'a3', pts: [[200, 170], [200, 240]] },
  { id: 'a4', pts: [[320, 285], [480, 285]] },
  { id: 'a5', pts: [[800, 285], [1300, 285]] },
  { id: 'a6', pts: [[640, 330], [640, 660]] },
  { id: 'a7', pts: [[800, 700], [1300, 700]], both: true },
  { id: 'a8', pts: [[640, 760], [640, 830]], thick: true },
  { id: 'a9', pts: [[640, 930], [640, 1000]], thick: true },
  { id: 'a10', pts: [[800, 1020], [1430, 1020], [1430, 960]] },
  { id: 'a11', pts: [[800, 1090], [900, 1090]] },
  { id: 'a12', pts: [[1100, 1100], [1180, 1100]] },
  { id: 'asave', pts: [[800, 880], [1300, 880]] },
  { id: 'acrawl', pts: [[190, 566], [190, 660]] },
  { id: 'aextract', pts: [[190, 760], [190, 830]] },
  { id: 'aafter', pts: [[330, 725], [440, 725], [440, 858], [480, 858]], dash: true },
  { id: 'allm', pts: [[480, 905], [330, 905]], both: true },
];

// ------------------------------------------------------------------ helpers
const hash = (s) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const colorOf = (k) => C[k] || C.ink;
const strokeOf = (b) => (b.c === 'ink' ? C.ink : colorOf(b.c));
const textW = (t, size) => Math.ceil(t.length * size * 0.56);
const LINE = 1.25;

// ------------------------------------------------------------------ SVG (rough, dark)
const gen = rough.generator();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const roundedPath = (x, y, w, h, r) =>
  `M ${x + r} ${y} L ${x + w - r} ${y} Q ${x + w} ${y} ${x + w} ${y + r} L ${x + w} ${y + h - r} Q ${x + w} ${y + h} ${x + w - r} ${y + h} ` +
  `L ${x + r} ${y + h} Q ${x} ${y + h} ${x} ${y + h - r} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`;
const pathsToSvg = (drawable) =>
  gen.toPaths(drawable).map((p) =>
    `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || 'none'}"` +
    `${drawable.options.strokeLineDash ? ` stroke-dasharray="${drawable.options.strokeLineDash.join(' ')}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`).join('');

const FONT = "'Excalifont','Virgil','Segoe Print','Bradley Hand','Chalkboard SE','Marker Felt','Comic Sans MS',cursive";
function svgText(lines, cx, cy, size, color, anchor = 'middle') {
  const total = lines.length * size * LINE;
  const y0 = cy - total / 2 + size * 0.9;
  return `<text x="${cx}" y="${y0}" font-family="${FONT}" font-size="${size}" fill="${color}" text-anchor="${anchor}">` +
    lines.map((l, i) => `<tspan x="${cx}" dy="${i === 0 ? 0 : size * LINE}">${esc(l) || '&#160;'}</tspan>`).join('') + '</text>';
}

function buildSvg() {
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>`];
  out.push(pathsToSvg(gen.path(roundedPath(10, 10, W - 20, H - 20, 24), { stroke: C.frame, strokeWidth: 2, roughness: 1.1, seed: 11 })));
  // title tag
  out.push(`<rect x="26" y="20" width="456" height="40" rx="8" fill="${C.bg}"/>`);
  out.push(pathsToSvg(gen.path(roundedPath(26, 20, 456, 40, 8), { stroke: C.mute, strokeWidth: 1.5, roughness: 1, seed: 5 })));
  out.push(svgText(['Loan-eligibility-engine-system-design'], 254, 40, 22, C.ink));
  for (const b of boxes) {
    const stroke = strokeOf(b);
    out.push(pathsToSvg(gen.path(roundedPath(b.x, b.y, b.w, b.h, 14), {
      stroke, strokeWidth: 2.2, roughness: 1.2, seed: hash(b.id), fill: FILL[b.c], fillStyle: 'solid' })));
    const size = b.lines.length > 2 ? 20 : 22;
    if (b.top) {
      out.push(svgText([b.lines[0]], b.x + b.w / 2, b.y + 40, 24, C.ink));
      out.push(svgText(b.lines.slice(2), b.x + b.w / 2, b.y + 70 + (b.lines.length - 2) * 17, 21, C.mute));
    } else {
      out.push(svgText(b.lines, b.x + b.w / 2, b.y + b.h / 2, size, C.ink));
    }
  }
  for (const a of arrows) {
    const color = a.dash ? C.mute : C.ink;
    const opts = { stroke: color, strokeWidth: a.thick ? 4.5 : 2, roughness: 1, seed: hash(a.id) };
    if (a.dash) opts.strokeLineDash = [9, 9];
    out.push(pathsToSvg(gen.linearPath(a.pts, opts)));
    const head = (from, to) => {
      const ang = Math.atan2(to[1] - from[1], to[0] - from[0]), L = a.thick ? 22 : 15;
      return [-0.45, 0.45].map((d) => pathsToSvg(gen.line(to[0], to[1], to[0] - L * Math.cos(ang + d), to[1] - L * Math.sin(ang + d),
        { stroke: color, strokeWidth: a.thick ? 4.5 : 2, roughness: 0.6, seed: hash(a.id + d) }))).join('');
    };
    const n = a.pts.length;
    out.push(head(a.pts[n - 2], a.pts[n - 1]));
    if (a.both) out.push(head(a.pts[1], a.pts[0]));
  }
  for (const t of texts) {
    out.push(svgText([t.text], t.x, t.y + t.s * LINE / 2, t.s, colorOf(t.color) === C.ink && !t.color ? C.ink : colorOf(t.color || 'ink'), 'start'));
  }
  out.push('</svg>');
  return out.join('\n');
}

// ------------------------------------------------------------------ Excalidraw file
let seedN = 100;
const base = (o) => ({ angle: 0, fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100,
  groupIds: [], frameId: null, roundness: null, seed: (seedN += 37), version: 1, versionNonce: (seedN += 11),
  isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, ...o });
const mkText = (id, x, y, lines, size, color, extra = {}) => base({
  type: 'text', id, x, y, width: Math.max(...lines.map((l) => textW(l, size))), height: lines.length * size * LINE,
  strokeColor: color, backgroundColor: 'transparent', text: lines.join('\n'), originalText: lines.join('\n'), fontSize: size,
  fontFamily: 1, textAlign: 'left', verticalAlign: 'top', containerId: null, autoResize: true, lineHeight: LINE, ...extra });

function buildExcalidraw() {
  const els = [];
  els.push(base({ type: 'rectangle', id: 'frame', x: 10, y: 10, width: W - 20, height: H - 20, strokeColor: C.frame,
    backgroundColor: 'transparent', roundness: { type: 3 } }));
  els.push(base({ type: 'rectangle', id: 'tag', x: 26, y: 20, width: 456, height: 40, strokeColor: C.mute, strokeWidth: 1,
    backgroundColor: C.bg, roundness: { type: 3 } }));
  els.push(mkText('tagtext', 40, 28, ['Loan-eligibility-engine-system-design'], 22, C.ink));
  for (const b of boxes) {
    const tid = b.id + '_t';
    els.push(base({ type: 'rectangle', id: b.id, x: b.x, y: b.y, width: b.w, height: b.h, strokeColor: strokeOf(b),
      backgroundColor: FILL[b.c], roundness: { type: 3 }, boundElements: [{ id: tid, type: 'text' }] }));
    const size = b.top ? 21 : (b.lines.length > 2 ? 20 : 22);
    const w = Math.max(...b.lines.map((l) => textW(l, size))), h = b.lines.length * size * LINE;
    els.push(mkText(tid, b.x + (b.w - w) / 2, b.top ? b.y + 30 : b.y + (b.h - h) / 2, b.lines, size, C.ink,
      { containerId: b.id, textAlign: 'center', verticalAlign: b.top ? 'top' : 'middle' }));
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
  for (const t of texts) els.push(mkText(t.id, t.x, t.y, [t.text], t.s, colorOf(t.color || 'ink')));
  return { type: 'excalidraw', version: 2, source: 'https://excalidraw.com', elements: els,
    appState: { viewBackgroundColor: C.bg, gridSize: null, theme: 'dark' }, files: {} };
}

// ------------------------------------------------------------------ MCP preview elements (skeleton format)
function buildMcp() {
  const els = [{ type: 'rectangle', id: 'darkbg', x: -4000, y: -3000, width: 10000, height: 7500, backgroundColor: C.bg,
    fillStyle: 'solid', strokeColor: 'transparent', strokeWidth: 0 },
  { type: 'cameraUpdate', width: 1600, height: 1200, x: 0, y: 0 },
  { type: 'rectangle', id: 'frame', x: 10, y: 10, width: W - 20, height: H - 20, strokeColor: C.frame, roundness: { type: 3 } },
  { type: 'rectangle', id: 'tag', x: 26, y: 20, width: 456, height: 40, strokeColor: C.mute, strokeWidth: 1, backgroundColor: C.bg,
    fillStyle: 'solid', roundness: { type: 3 }, label: { text: 'Loan-eligibility-engine-system-design', fontSize: 22 } }];
  for (const b of boxes) {
    els.push({ type: 'rectangle', id: b.id, x: b.x, y: b.y, width: b.w, height: b.h, strokeColor: strokeOf(b),
      backgroundColor: FILL[b.c], fillStyle: 'solid', roundness: { type: 3 },
      label: { text: b.lines.join('\n'), fontSize: b.top ? 21 : (b.lines.length > 2 ? 20 : 22) } });
  }
  for (const a of arrows) {
    const [x0, y0] = a.pts[0];
    const rel = a.pts.map(([x, y]) => [x - x0, y - y0]);
    els.push({ type: 'arrow', id: a.id, x: x0, y: y0, width: Math.max(...rel.map((p) => Math.abs(p[0]))),
      height: Math.max(...rel.map((p) => Math.abs(p[1]))), points: rel, strokeColor: a.dash ? C.mute : C.ink,
      strokeWidth: a.thick ? 4 : 2, strokeStyle: a.dash ? 'dashed' : 'solid',
      startArrowhead: a.both ? 'arrow' : null, endArrowhead: 'arrow' });
  }
  for (const t of texts) els.push({ type: 'text', id: t.id, x: t.x, y: t.y, text: t.text, fontSize: t.s, strokeColor: colorOf(t.color || 'ink') });
  return els;
}

// ------------------------------------------------------------------ write
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs/architecture.svg'), buildSvg());
fs.writeFileSync(path.join(ROOT, 'docs/architecture.excalidraw'), JSON.stringify(buildExcalidraw(), null, 1));
if (process.argv[2]) fs.writeFileSync(path.join(process.argv[2], 'architecture.mcp.json'), JSON.stringify(buildMcp()));
console.log('wrote docs/architecture.svg and docs/architecture.excalidraw' + (process.argv[2] ? ' + MCP json' : ''));
