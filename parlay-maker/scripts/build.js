#!/usr/bin/env node
// Builds today's Edge Lab card → data/latest.js (loaded by index.html, works even from file://)
// Usage: ODDS_API_KEY=xxx node scripts/build.js [--budget N|auto] [--all-books]
//        node scripts/build.js --reanalyze   (refresh ESPN analysis only, no odds credits)
const fs = require('fs');
const path = require('path');
const Engine = require('../engine.js');

const args = process.argv.slice(2);
const opt = (name, d) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : d; };
const key = process.env.ODDS_API_KEY;
if (!key && !args.includes('--reanalyze')) { console.error('Set ODDS_API_KEY'); process.exit(1); }

const get = async url => {
  const r = await fetch(url, { headers: { 'user-agent': 'edge-lab-daily/1.0', accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url.replace(/apiKey=[^&]+/, 'apiKey=***').slice(0, 120)}`);
  return { json: await r.json(), headers: n => r.headers.get(n) };
};

(async () => {
  const out = path.join(__dirname, '..', 'data'), file = path.join(out, 'latest.js');
  if (args.includes('--reanalyze')) {
    // re-run the free ESPN analysis on the saved card without spending odds credits
    global.window = {}; require(file);
    const card = await Engine.analyzeCard(window.EDGE_CARD, get, m => console.log('·', m));
    fs.writeFileSync(file, 'window.EDGE_CARD = ' + JSON.stringify(card) + ';\n');
    return console.log('re-analyzed data/latest.js');
  }
  const card = await Engine.buildCard({
    get, key,
    budget: opt('--budget', process.env.DAILY_BUDGET || 'auto'),
    allowAll: args.includes('--all-books'),
    log: m => console.log('·', m),
  });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'latest.js'), 'window.EDGE_CARD = ' + JSON.stringify(card) + ';\n');
  console.log(`wrote data/latest.js (${(fs.statSync(path.join(out, 'latest.js')).size / 1024).toFixed(0)} KB)`);
})().catch(e => { console.error(e); process.exit(1); });
