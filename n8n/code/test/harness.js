// Minimal harness to run an n8n Code-node body locally with Node, so the parsing logic
// can be tested against saved HTML without spinning up n8n.
//
//   node harness.js <code.js> <inputs.json> <upstream.json>
//     inputs.json   : array of item.json objects for $input.all()
//     upstream.json : { "<Node name>": [item.json, ...], ... } for $('<Node name>').all()
const fs = require('fs');
const [codeFile, inputsFile, upstreamFile] = process.argv.slice(2);
const wrap = (arr) => arr.map((j, i) => ({ json: j, pairedItem: { item: i } }));
const inputs = wrap(JSON.parse(fs.readFileSync(inputsFile, 'utf8')));
const upstream = upstreamFile ? JSON.parse(fs.readFileSync(upstreamFile, 'utf8')) : {};
const $input = { all: () => inputs, first: () => inputs[0] };
const $ = (name) => ({ all: () => wrap(upstream[name] || []), itemMatching: (i) => wrap(upstream[name] || [])[i] });
const body = fs.readFileSync(codeFile, 'utf8').replace('__PROVIDER__', process.env.PROVIDER || 'groq');
const log = { log: (...a) => console.error(...a) }; // keep stdout clean for the JSON result
// Shadow globals that n8n's Code-node sandbox does NOT provide, so a test can't pass by
// accident on something that would fail in production (this bit us with `URL`).
const fn = new Function('$input', '$', 'console', 'URL', 'URLSearchParams', `"use strict"; ${body}`);
const result = fn($input, $, log, undefined, undefined);
process.stdout.write(JSON.stringify(result.map((r) => r.json)));
