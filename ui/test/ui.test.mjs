import { JSDOM } from 'jsdom';
import fs from 'fs';
// Drives the real index.html + app.js in a simulated browser (jsdom) against ui/test/mock_api.py.
import path from 'path';
import { fileURLToPath } from 'url';
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(SITE + '/index.html', 'utf8').replace(/<script src="(config|app)\.js"[^>]*><\/script>/g, '').replace(/<link[^>]*fonts[^>]*>/g, '');
const dom = new JSDOM(html, { url: 'http://127.0.0.1:8800/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
w.CONFIG = { API_URL: 'http://127.0.0.1:8799', API_KEY: 'demo' };
w.fetch = (u, o) => fetch(u, o);                     // Node's fetch -> the mock API
w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
w.HTMLElement.prototype.scrollIntoView = () => {}; w.scrollTo = () => {};
w.eval(fs.readFileSync(SITE + '/app.js', 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => w.document.getElementById('app').textContent.replace(/\s+/g, ' ');
const results = [];
const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' - ' + extra : ''}`); };

await wait(400);
ok('home renders hero + live lenders + comparison', /Every lender\./.test(text()) && /Axis Bank/.test(text()) && /Best rate found: Axis Bank at 8\.75%/.test(text()));
ok('home FAQ has 5 questions', w.document.querySelectorAll('.faq details').length === 5);

w.location.hash = '#/check'; await wait(100);
ok('check page has the form', !!w.document.getElementById('inc'));
w.document.getElementById('inc').value = '61000'; w.document.getElementById('scr').value = '655'; w.document.getElementById('age').value = '50';
w.document.querySelectorAll('.pill')[1].click();
ok('employment pill toggles', w.document.querySelectorAll('.pill')[1].getAttribute('aria-pressed') === 'true' && w.document.querySelectorAll('.pill')[0].getAttribute('aria-pressed') === 'false');
w.document.querySelector('form').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true })); await wait(400);
ok('check shows 5 ranked offers with rates', w.document.querySelectorAll('.offer').length === 5 && /8\.75%/.test(text()) && /Good to know/.test(text()));

w.location.hash = '#/lenders'; await wait(400);
ok('lenders table lists all lenders', w.document.querySelectorAll('tbody tr').length === 12);
const q = w.document.querySelector('.search input'); q.value = 'axis'; q.dispatchEvent(new w.Event('input'));
ok('lender search filters', w.document.querySelectorAll('tbody tr').length === 1);

w.location.hash = '#/console/overview'; await wait(500);
ok('console overview shows KPIs and funnel', /10,000/.test(text()) && /450,000/.test(text()) && /Emailed/.test(text()) && /LLM calls while matching: 0/.test(text()));

w.location.hash = '#/console/customers'; await wait(200);
const cq = w.document.querySelector('.search input'); cq.value = 'saanvi';
[...w.document.querySelectorAll('button')].find((b) => b.textContent === 'Search').click(); await wait(300);
ok('customer search lists people', w.document.querySelectorAll('.person').length === 2);
w.document.querySelector('.person').click(); await wait(400);
ok('customer detail: profile, 5 offers, masked inbox, no raw email', w.document.querySelectorAll('.offer').length === 5 && /a\*\*\*\+one@gmail\.com/.test(text()) && /Score 655/.test(text()) && !/@example\.com/.test(text()));

w.location.hash = '#/console/upload'; await wait(300);
ok('upload tab has the drop zone and stepper', !!w.document.querySelector('.drop') && w.document.querySelectorAll('.stp').length === 5);

// 401 path: wrong key must clear the stored key and show the error, not crash
w.CONFIG.API_KEY = ''; w.localStorage.setItem('lm_key', 'wrong'); w.location.hash = '#/console/overview'; await wait(500);
ok('wrong key shows an error and removes the stored key', /access key was not accepted/.test(text()) && w.localStorage.getItem('lm_key') === null);
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
