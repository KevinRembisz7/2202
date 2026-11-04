/* Edge Lab UI — renders the daily card (data/latest.js) and can rebuild it live in the browser. */
(() => {
  'use strict';
  const E = window.Engine, { toAm, pct, esc } = E;
  const $ = id => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('edge.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('edge.' + k, JSON.stringify(v)); } catch (e) {} },
  };

  // ---------- state ----------
  let card = pickCard();
  const S = {
    tab: store.get('tab', 'top'), lg: 'ALL', market: 'ALL', q: '', sort: 'ev',
    slip: store.get('slip', []), bankroll: store.get('bankroll', 500), kfrac: store.get('kfrac', 0.25),
    key: store.get('key', ''), budget: store.get('budget', 20), allBooks: store.get('allBooks', false),
  };
  let byId = {};
  function pickCard() {
    const daily = window.EDGE_CARD, live = store.get('liveCard', null);
    if (live && (!daily || live.generatedAt > daily.generatedAt)) return live;
    return daily;
  }
  function index() {
    byId = {};
    if (!card) return;
    for (const x of [...card.lines, ...card.props]) byId[x.id] = x;
    S.slip = S.slip.filter(id => byId[id]);
  }

  // ---------- helpers ----------
  const fmtTime = iso => iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const signPct = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
  const vibeCls = v => !v ? 'v-n' : v.score >= 2 ? 'v-g' : v.score <= -2 ? 'v-b' : 'v-n';
  const vibeTxt = v => !v ? '—' : (v.score >= 2 ? '🟢 ' : v.score <= -2 ? '🔴 ' : '🟡 ') + (v.score > 0 ? '+' : '') + v.score;
  const isSus = x => x.ev >= (x.type === 'prop' ? E.PROP_STALE : E.STALE);
  const gameOf = x => card.games?.[x.eventId];
  function teamSide(x) {
    const g = gameOf(x); if (!g || !x.team) return null;
    if (x.type === 'prop') return g.home.abbr === x.team ? g.home : g.away;
    return E.norm(x.team) === E.norm(x.home) ? g.home : g.away;
  }
  function avatar(x, cls = '') {
    if (x.type === 'prop' && x.headshot) return `<div class="avatar ${cls}"><img src="${esc(x.headshot)}" alt="" loading="lazy" onerror="this.remove()"></div>`;
    const t = teamSide(x);
    if (t?.logo) return `<div class="avatar logo ${cls}"><img src="${esc(t.logo)}" alt="" loading="lazy" onerror="this.remove()"></div>`;
    return `<div class="avatar ${cls}">${x.emoji || '🎲'}</div>`;
  }
  function titleOf(x) {
    if (x.type === 'prop') return { n: x.player, p: `${x.side} ${x.point} ${x.statLabel}`, g: `${x.team || ''}${x.opp ? ' vs ' + x.opp : ''} · ${x.game}` };
    if (x.market === 'totals') return { n: x.game, p: x.pick, g: 'Game total' };
    const g = gameOf(x), t = teamSide(x);
    const sub = x.market === 'h2h' ? 'Moneyline' : `Spread ${x.point > 0 ? '+' : ''}${x.point}`;
    return { n: x.team, p: sub, g: (t && g ? `${t.rec ? t.rec + ' · ' : ''}` : '') + x.game };
  }
  function sparkSVG(hit, line, w = 120, h = 34) {
    if (!hit?.vals?.length) return '';
    const vals = [...hit.vals].reverse(), max = Math.max(line * 1.4, ...vals, 1), bw = w / vals.length;
    const y = v => h - (v / max) * (h - 2);
    const bars = vals.map((v, i) => `<rect x="${i * bw + 1}" y="${y(v)}" width="${bw - 2}" height="${h - y(v)}" rx="2"
      fill="${v > line ? 'var(--edge)' : 'var(--bad)'}" opacity=".85"><title>${v}</title></rect>`).join('');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${bars}
      <line x1="0" x2="${w}" y1="${y(line)}" y2="${y(line)}" stroke="var(--ink)" stroke-dasharray="3 3" stroke-width="1" opacity=".7"/></svg>`;
  }

  // ---------- pick card ----------
  function pickCard_(x, hot = false) {
    const t = titleOf(x), v = x.vibe, inSlip = S.slip.includes(x.id);
    const items = (v?.items || []).filter(i => i.tone !== 'n' || /🎯/.test(i.text)).slice(0, 2);
    const hit = x.vibe?.hit;
    return `<article class="card ${hot ? 'hot' : ''}" data-open="${esc(x.id)}">
      <div class="c-top"><span class="tag">${x.emoji} ${esc(x.lg)}</span><span>${esc(fmtTime(x.start))}</span>
        <span class="spacer"></span><span class="vibe ${vibeCls(v)}" title="Matchup vibe">${vibeTxt(v)}</span></div>
      <div class="c-main">${avatar(x)}
        <div class="c-title"><div class="n">${esc(t.n)}</div><div class="p">${esc(t.p)}</div><div class="g">${esc(t.g)}</div></div>
        <div class="price"><b>${toAm(x.dec)}</b><small>${esc(x.book)}</small></div></div>
      <div>
        <div class="meter"><span>True</span><div class="track"><i style="width:${x.fairP * 100}%;background:var(--edge)"></i></div><b>${pct(x.fairP, 0)}</b></div>
        <div class="meter"><span>Book</span><div class="track"><i style="width:${100 / x.dec}%;background:var(--muted)"></i></div><b>${pct(1 / x.dec, 0)}</b></div>
      </div>
      ${hit ? `<div class="spark">${sparkSVG(hit, x.point)}<div><span class="hitrate">${hit.hits}/${hit.n}</span> ${x.side.toLowerCase()} last ${hit.n}<br>avg ${hit.avg.toFixed(1)} · line ${x.point}</div></div>` : ''}
      ${items.length ? `<ul class="why-mini">${items.map(i => `<li class="${i.tone}">${i.text}</li>`).join('')}</ul>` : ''}
      <div class="c-foot"><span class="edge ${x.ev < 0 ? 'neg' : ''}">${signPct(x.ev)} EV</span>
        <span class="muted" style="font-size:12px">fair ${toAm(1 / x.fairP)}</span>${isSus(x) ? '<span class="sus">⚠ sus line</span>' : ''}
        <button class="add ${inSlip ? 'in' : ''}" data-add="${esc(x.id)}">${inSlip ? '✓ In slip' : '+ Slip'}</button></div>
    </article>`;
  }

  // ---------- views ----------
  const TABS = [['top', '🔥 Top Picks'], ['props', '🎯 Player Props'], ['lines', '📊 Game Lines'], ['parlays', '🧮 Parlays'], ['how', '📘 How it works']];
  function renderTabs() {
    $('tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}</button>`).join('');
  }
  function leagues(items) { return ['ALL', ...new Set(items.map(x => x.lg))]; }
  function filtered(items) {
    const q = E.norm(S.q);
    return items.filter(x => (S.lg === 'ALL' || x.lg === S.lg) && (S.market === 'ALL' || x.statLabel === S.market)
      && (!q || E.norm(x.pick + ' ' + x.game).includes(q)));
  }
  function sortItems(items) {
    const k = { ev: x => x.ev, vibe: x => (x.vibe?.score || 0) + x.ev, hit: x => x.vibe?.hit?.l10 ?? -1, time: x => -new Date(x.start) }[S.sort] || (x => x.ev);
    return [...items].sort((a, b) => k(b) - k(a));
  }
  function renderFilters(items, opts = {}) {
    if (!items) { $('filters').innerHTML = ''; return; }
    const lg = leagues(items);
    const markets = opts.markets ? ['ALL', ...new Set(items.filter(x => S.lg === 'ALL' || x.lg === S.lg).map(x => x.statLabel))] : null;
    $('filters').innerHTML = lg.map(l => `<button class="chip ${S.lg === l ? 'on' : ''}" data-lg="${esc(l)}">${l === 'ALL' ? 'All' : esc(l)}</button>`).join('')
      + (markets && markets.length > 2 ? '<span style="width:8px"></span>' + markets.map(m => `<button class="chip ${S.market === m ? 'on' : ''}" data-mk="${esc(m)}">${m === 'ALL' ? 'All stats' : esc(m)}</button>`).join('') : '')
      + `<span class="spacer"></span><input id="q" placeholder="Search team or player" value="${esc(S.q)}" size="18">
         <select id="sort"><option value="ev">Sort: Edge</option><option value="vibe">Sort: Vibe</option>${opts.markets ? '<option value="hit">Sort: Hit rate</option>' : ''}<option value="time">Sort: Start time</option></select>`;
    $('sort').value = S.sort;
  }

  function viewTop() {
    const all = [...card.lines, ...card.props].filter(x => !isSus(x));
    const best = sortItems(filtered(all).filter(x => (x.vibe?.score || 0) >= 0)).sort((a, b) =>
      (b.ev + (b.vibe?.score || 0) * 0.012) - (a.ev + (a.vibe?.score || 0) * 0.012)).slice(0, 12);
    const fades = filtered(all).filter(x => x.vibe?.score <= -2).sort((a, b) => b.ev - a.ev).slice(0, 3);
    return `<div class="sec"><h2>Best bets on the board</h2><span>edge + matchup backing, sus lines removed</span></div>
      ${best.length ? `<div class="grid">${best.map((x, i) => pickCard_(x, i < 3)).join('')}</div>` : empty('No +EV picks match these filters.')}
      ${card.parlays?.length ? `<div class="sec"><h2>Today's parlays</h2><span>auto-built, one leg per game</span></div><div class="pgrid">${card.parlays.map((p, i) => parlayCard(p, i === 1)).join('')}</div>` : ''}
      ${fades.length ? `<div class="sec"><h2>🚩 Price says yes, matchup says no</h2><span>+EV on paper, but the data fades them — tap to see why</span></div><div class="grid">${fades.map(x => pickCard_(x)).join('')}</div>` : ''}`;
  }
  function viewProps() {
    const items = sortItems(filtered(card.props));
    return `<div class="sec"><h2>Player props</h2><span>${card.props.length} +EV prop sides · bars = last games vs the line</span></div>
      ${items.length ? `<div class="grid">${items.map(x => pickCard_(x)).join('')}</div>`
        : empty(card.props.length ? 'No props match these filters.' : 'No props on today\'s card — props only get pulled for games starting within ~30h, and only if the daily credit budget allows.')}`;
  }
  function viewLines() {
    const items = sortItems(filtered(card.lines));
    if (!items.length) return empty('No +EV game lines match these filters.');
    return `<div class="sec"><h2>Game lines</h2><span>moneylines, spreads &amp; totals vs Pinnacle no-vig</span></div>
      <div class="tbl"><div class="scroll"><table><thead><tr><th></th><th>Pick</th><th>Game</th><th>Start</th><th>Price</th><th>Book</th><th>Fair</th><th>True %</th><th>Edge</th><th>Vibe</th><th></th></tr></thead><tbody>
      ${items.map(x => `<tr data-open="${esc(x.id)}"><td><span class="tag">${x.emoji} ${esc(x.lg)}</span></td><td><b>${esc(x.pick)}</b></td><td class="muted">${esc(x.game)}</td>
        <td class="muted">${esc(fmtTime(x.start))}</td><td><b>${toAm(x.dec)}</b></td><td>${esc(x.book)}</td><td class="muted">${toAm(1 / x.fairP)}</td><td>${pct(x.fairP)}</td>
        <td><span class="edge">${signPct(x.ev)}</span>${isSus(x) ? ' <span class="sus">⚠ sus</span>' : ''}</td><td><span class="vibe ${vibeCls(x.vibe)}">${vibeTxt(x.vibe)}</span></td>
        <td><button class="add ${S.slip.includes(x.id) ? 'in' : ''}" data-add="${esc(x.id)}">${S.slip.includes(x.id) ? '✓' : '+'}</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
  }
  function parlayCard(p, feat) {
    const legs = p.legs.map(id => byId[id]).filter(Boolean);
    if (!legs.length) return '';
    const s = E.parlayStats(legs, S.kfrac);
    return `<div class="parlay ${feat ? 'feat' : ''}">
      <h3>${p.emoji || '🎟️'} ${esc(p.name)} <span class="odds">${toAm(s.dec)}</span></h3>
      ${p.blurb ? `<div class="blurb">${esc(p.blurb)}</div>` : ''}
      ${legs.map(l => { const t = titleOf(l); return `<div class="pleg" data-open="${esc(l.id)}" style="cursor:pointer">${avatar(l)}<div class="t"><b>${esc(t.n)}</b><span class="muted">${esc(t.p)} · ${esc(l.book)}</span></div><b>${toAm(l.dec)}</b></div>`; }).join('')}
      <div class="pstats"><div><small>Hit</small><b>${pct(s.p, 1)}</b></div><div><small>EV</small><b style="color:var(--edge)">${signPct(s.ev)}</b></div>
        <div><small>Stake</small><b>$${(s.f * S.bankroll).toFixed(2)}</b></div><div><small>$10 pays</small><b>$${(10 * s.dec).toFixed(0)}</b></div></div>
      <button class="btn small" data-loadparlay="${esc(p.legs.join(','))}">Load into slip</button>
    </div>`;
  }
  let built = null;
  function viewParlays() {
    return `<div class="sec"><h2>Auto-built parlays</h2><span>from today's card</span></div>
      ${card.parlays?.length ? `<div class="pgrid">${card.parlays.map((p, i) => parlayCard(p, i === 1)).join('')}</div>` : empty('Not enough +EV legs to build parlays today.')}
      <div class="sec"><h2>Build your own</h2><span>+EV legs only, max one per game, no 🔴 fades</span></div>
      <div class="builder">
        <label>Legs<select id="bk">${[2, 3, 4, 5].map(n => `<option ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label>Rank by<select id="brank"><option value="growth">Bankroll growth</option><option value="ev">Raw EV</option><option value="hit">Hit chance</option><option value="vibe">Matchup vibe</option></select></label>
        <label>Use<select id="bsrc"><option value="all">Props + lines</option><option value="prop">Props only</option><option value="line">Lines only</option></select></label>
        <label>League<select id="blg">${leagues([...card.lines, ...card.props]).map(l => `<option ${S.lg === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <button class="btn primary" id="buildBtn">Build</button>
      </div>
      <div class="pgrid" id="builtOut">${built || ''}</div>`;
  }
  function viewHow() {
    return `<div class="sec"><h2>How the edge works</h2></div>
      <div class="flow">
        <div class="step">Sharp line<small>Pinnacle: KC -250 / NYJ +210</small></div><span class="arr">→</span>
        <div class="step">Strip the vig<small>power de-vig → NYJ 31.1%</small></div><span class="arr">→</span>
        <div class="step">Shop every book<small>best: +250 @ FanDuel</small></div><span class="arr">→</span>
        <div class="step">Edge<small>0.311 × 3.50 − 1 = <b style="color:var(--edge)">+8.9%</b></small></div><span class="arr">→</span>
        <div class="step">Matchup check<small>injuries · hit rate · model</small></div>
      </div>
      <div class="how">
        <div class="card"><h3>🎯 Why sharp lines?</h3><p>Pinnacle takes giant bets from pros and moves fast, so its price is the closest thing to the real odds. Remove its fee and you get the true win %. When DraftKings or FanDuel pay more than that, you're getting paid more than the bet is worth.</p></div>
        <div class="card"><h3>🧑‍🤝‍🧑 Props: consensus</h3><p>When Pinnacle doesn't hang a prop, the fair line is the median no-vig price across 3+ books. A book that's out of line with everyone else is the edge — the classic prop "line shop".</p></div>
        <div class="card"><h3>📊 Hit-rate bars</h3><p>Each bar is one recent game: green = cleared the line, red = didn't, dashed line = tonight's number. Hit rate backs the price — it never replaces it (small samples lie).</p></div>
        <div class="card"><h3>🧠 Vibe score</h3><p>+1 for each thing backing the pick (ESPN model agrees, opposing starters out, teammate out → more usage, form, scoring projection), −1 for each against. 🟢 +2 or better, 🔴 −2 or worse.</p></div>
        <div class="card"><h3>🧮 Parlays</h3><p>Edges multiply: three +3% legs ≈ +9.3%. Three normal −110 legs ≈ −13%, which is why random parlays bleed money. Only +EV legs, one per game — same-game legs are correlated.</p></div>
        <div class="card"><h3>💰 Kelly stake</h3><p>Stake = (b·p − q)/b of bankroll — the size that grows a bankroll fastest long-run. Default is ¼ Kelly because parlays swing hard. Tiny stakes are a feature, not a bug.</p></div>
        <div class="card"><h3>⏰ Auto-updates</h3><p>A GitHub Action rebuilds this card every morning and spends a slice of your monthly Odds API credits (credits left ÷ days left). Hit <b>↻ Live refresh</b> with your key for fresh lines any time.</p></div>
        <div class="card"><h3>⚠️ Real talk</h3><p>Edges are small and variance is huge — a +10% EV parlay at 15% hit chance still loses 85% of the time. Books limit winners. Edges over 15% are usually stale lines and get flagged. Bet what you can lose.</p></div>
      </div>`;
  }
  const empty = msg => `<div class="empty">${msg}</div>`;

  function renderKPIs() {
    if (!card) { $('kpis').innerHTML = ''; return; }
    const all = [...card.lines, ...card.props].filter(x => !isSus(x));
    const bestE = all.reduce((a, b) => !a || b.ev > a.ev ? b : a, null);
    const top = card.parlays?.[1] || card.parlays?.[0];
    const topS = top ? E.parlayStats(top.legs.map(id => byId[id]).filter(Boolean), S.kfrac) : null;
    const games = card.sports.reduce((a, s) => a + s.games, 0);
    $('kpis').innerHTML = [
      ['Games scanned', games, card.sports.map(s => s.emoji + ' ' + s.lg).join(' ')],
      ['+EV picks', all.length, `${card.lines.length} lines · ${card.props.length} props`],
      ['Best edge', bestE ? signPct(bestE.ev) : '—', bestE ? bestE.pick : ''],
      ['Value parlay', topS ? toAm(topS.dec) : '—', topS ? `${pct(topS.p)} hit · ${signPct(topS.ev)} EV` : ''],
    ].map(([l, v, s]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${esc(v)}</div><div class="s" title="${esc(s)}">${esc(s)}</div></div>`).join('');
  }
  function renderMeta() {
    if (!card) { $('meta').innerHTML = 'No card yet — hit <b>↻ Live refresh</b> or run the daily build.'; return; }
    const d = new Date(card.generatedAt), age = (Date.now() - d) / 36e5;
    $('meta').innerHTML = `Card for <b>${d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</b> · updated ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      + (age > 26 ? ' <span class="sus">· stale, refresh</span>' : '') + (card.credits?.left != null ? ` · ${card.credits.left} API credits left` : '');
  }

  function render() {
    renderTabs(); renderMeta(); renderKPIs(); renderSlipbar();
    if (!card) {
      $('filters').innerHTML = '';
      $('view').innerHTML = empty(`<div style="font-size:40px">⚡</div><h2 style="color:var(--ink)">No card loaded</h2>
        <p>The daily GitHub Action writes <code>data/latest.js</code>. Or open ⚙️ Settings, paste your Odds API key and hit ↻ Live refresh.</p>`);
      return;
    }
    const v = { top: viewTop, props: viewProps, lines: viewLines, parlays: viewParlays, how: viewHow }[S.tab] || viewTop;
    renderFilters(S.tab === 'how' || S.tab === 'parlays' ? null : S.tab === 'props' ? card.props : S.tab === 'lines' ? card.lines : [...card.lines, ...card.props], { markets: S.tab === 'props' });
    $('view').innerHTML = v();
  }

  // ---------- modal (details) ----------
  const stBadge = s => /^out/i.test(s) ? '<span class="st o">OUT</span>' : /^doubt/i.test(s) ? '<span class="st d">DBT</span>'
    : /^quest|day/i.test(s) ? '<span class="st q">Q</span>' : /reserve/i.test(s) ? '<span class="st ir">IR</span>' : `<span class="st ir">${esc(s.slice(0, 3))}</span>`;
  function openDetail(id) {
    const x = byId[id]; if (!x) return;
    const t = titleOf(x), g = gameOf(x), v = x.vibe || { items: [] }, hit = v.hit;
    let probs = `<h4>Win chance</h4>
      <div class="meter"><span>True</span><div class="track"><i style="width:${x.fairP * 100}%;background:var(--edge)"></i></div><b>${pct(x.fairP, 0)}</b></div>
      <div class="meter"><span>Book</span><div class="track"><i style="width:${100 / x.dec}%;background:var(--muted)"></i></div><b>${pct(1 / x.dec, 0)}</b></div>`;
    if (x.type === 'line' && x.market === 'h2h' && g?.model) {
      const side = teamSide(x), m = side && g.model[side.name];
      if (m != null) probs += `<div class="meter"><span>ESPN</span><div class="track"><i style="width:${m * 100}%;background:var(--accent)"></i></div><b>${pct(m, 0)}</b></div>`;
    }
    const hitBlock = hit ? `<h4 style="margin-top:16px">Last ${hit.n} games vs ${x.point}</h4>${sparkSVG(hit, x.point, 300, 80)}
      <p class="note">${x.side} hit <b>${hit.hits}/${hit.n}</b> (${hit.h5}/${hit.n5} last 5) · average <b>${hit.avg.toFixed(1)}</b> · most recent on the right</p>` : '';
    const priceList = (x.prices || []).slice().sort((a, b) => b.dec - a.dec).slice(0, 6)
      .map(p => `<span class="tag" style="margin:0 4px 4px 0;display:inline-block">${esc(p.title)} ${toAm(p.dec)}</span>`).join('');
    let gameBlock = '';
    if (g) {
      const isNum = s => /^-?[\d.,]+%?$/.test(String(s).trim()), num = s => parseFloat(String(s).replace(/,/g, ''));
      const keys = Object.keys(g.away.stats).filter(k => k in g.home.stats && isNum(g.home.stats[k]) && isNum(g.away.stats[k])).slice(0, 9);
      const rows = keys.map(k => { const a = num(g.away.stats[k]), h = num(g.home.stats[k]), m = Math.max(Math.abs(a), Math.abs(h)) || 1;
        return `<div class="vs"><div class="l">${esc(g.away.stats[k])}<div class="hb" style="width:${Math.abs(a) / m * 100}%"></div></div><div class="lbl">${esc(k)}</div><div class="r"><div class="hb h" style="width:${Math.abs(h) / m * 100}%"></div>${esc(g.home.stats[k])}</div></div>`; }).join('');
      const pj = E.projection(g);
      const col = tm => `<div><h4>${esc(tm.abbr)} ${esc(tm.rec)} · last 5</h4><div class="dots">${tm.l5.map(r => `<span class="${esc(r.r)}" title="${esc(r.at)} ${esc(r.opp)} ${esc(r.sc)}">${esc(r.r)}</span>`).join('') || '<span class="muted">—</span>'}</div>
        <h4 style="margin-top:12px">Leaders</h4>${tm.leaders.map(l => `<div class="inj">${E.isOut(tm, l.id) ? '<span class="st o">OUT</span>' : ''}<b>${esc(l.label)}:</b> ${esc(l.name)} <span class="muted">${esc(l.val)}</span></div>`).join('') || '<span class="muted">—</span>'}
        <h4 style="margin-top:12px">Injuries</h4>${tm.injuries.length ? tm.injuries.map(p => `<div class="inj">${stBadge(p.status)}${esc(p.name)} <span class="muted">${esc(p.pos)} · ${esc(p.type)}</span></div>`).join('') : '<span class="muted">None listed</span>'}</div>`;
      gameBlock = `<div><h4>Season stats · ${esc(g.away.abbr)} vs ${esc(g.home.abbr)}</h4>${rows || '<span class="muted">No team stats</span>'}
        ${pj ? `<p class="note">Projected from season averages: ${esc(g.away.abbr)} ${pj.away.toFixed(1)} – ${esc(g.home.abbr)} ${pj.home.toFixed(1)}</p>` : ''}</div>
        <div class="teamcols">${col(g.away)}${col(g.home)}</div>`;
    }
    $('modal').innerHTML = `<div class="m-head">${avatar(x)}<div class="c-title"><div class="n" style="font-size:19px">${esc(t.n)}</div><div class="p">${esc(t.p)}</div><div class="g">${esc(x.game)} · ${esc(fmtTime(x.start))}</div></div>
        <div class="price"><b>${toAm(x.dec)}</b><small>${esc(x.book)}</small></div><button class="x" data-close>✕</button></div>
      <div class="m-body">
        <div><h4>Why this pick <span class="vibe ${vibeCls(x.vibe)}">${vibeTxt(x.vibe)}</span></h4><ul class="why">${v.items.map(i => `<li class="${i.tone}">${i.text}</li>`).join('')}</ul>${hitBlock}</div>
        <div>${probs}
          <p class="note" style="margin-top:10px"><span class="edge">${signPct(x.ev)} EV</span> &nbsp;fair ${toAm(1 / x.fairP)} via ${esc(x.src)}${x.nBooks ? ` (${x.nBooks} books)` : ''}</p>
          ${isSus(x) ? '<div class="warnbox">⚠ Edge this big usually means a stale or mistaken line. Check news before betting.</div>' : ''}
          ${priceList ? `<h4 style="margin-top:14px">Best prices</h4><div>${priceList}</div>` : ''}
          <div style="margin-top:14px"><button class="btn primary" data-add="${esc(x.id)}">${S.slip.includes(x.id) ? '✓ In slip — remove' : '+ Add to slip'}</button></div>
        </div>
        ${gameBlock}
      </div>`;
    $('modal').classList.add('show'); $('overlay').classList.add('show');
  }

  // ---------- slip ----------
  const slipLegs = () => S.slip.map(id => byId[id]).filter(Boolean);
  function toggleSlip(id) {
    S.slip = S.slip.includes(id) ? S.slip.filter(x => x !== id) : [...S.slip, id];
    store.set('slip', S.slip); render();
    if ($('drawer').classList.contains('show') && $('drawerTitle').textContent.includes('slip')) openSlip();
    if ($('modal').classList.contains('show')) openDetail(id);
  }
  function renderSlipbar() {
    const ls = slipLegs(), bar = $('slipbar');
    if (!ls.length) { bar.classList.add('hide'); return; }
    bar.classList.remove('hide');
    const s = E.parlayStats(ls, S.kfrac);
    bar.innerHTML = `<div class="cnt">${ls.length}</div><div><b>${ls.length === 1 ? 'Single' : ls.length + '-leg parlay'}</b><br><span style="opacity:.85;font-size:13px">${pct(s.p)} hit · ${signPct(s.ev)} EV</span></div><div class="sb-odds">${toAm(s.dec)}</div>`;
  }
  function openSlip() {
    const ls = slipLegs(), s = ls.length ? E.parlayStats(ls, S.kfrac) : null;
    const same = new Set(ls.map(l => l.eventId)).size < ls.length, reds = ls.filter(l => l.vibe?.score <= -2);
    openDrawer('🧾 Your slip', ls.length ? `
      ${ls.map(l => { const t = titleOf(l); return `<div class="slipleg">${avatar(l)}<div class="t"><b>${esc(t.n)}</b>${esc(t.p)} · ${esc(l.book)} <span class="edge" style="font-size:11px">${signPct(l.ev)}</span></div><b>${toAm(l.dec)}</b><button class="x" data-add="${esc(l.id)}" title="Remove">✕</button></div>`; }).join('')}
      <div class="pstats"><div><small>Odds</small><b>${toAm(s.dec)}</b></div><div><small>Hit</small><b>${pct(s.p)}</b></div><div><small>EV</small><b style="color:${s.ev >= 0 ? 'var(--edge)' : 'var(--bad)'}">${signPct(s.ev)}</b></div><div><small>Stake</small><b>$${(s.f * S.bankroll).toFixed(2)}</b></div></div>
      <div class="meter"><span>True</span><div class="track"><i style="width:${Math.min(100, s.p * 100)}%;background:var(--edge)"></i></div><b>${pct(s.p, 0)}</b></div>
      <div class="meter"><span>Book</span><div class="track"><i style="width:${Math.min(100, s.implied * 100)}%;background:var(--muted)"></i></div><b>${pct(s.implied, 0)}</b></div>
      <p class="note">$10 pays <b>$${(10 * s.dec).toFixed(2)}</b> · expected profit per $10: <b>${s.ev >= 0 ? '+' : '−'}$${Math.abs(10 * s.ev).toFixed(2)}</b> · stake is ${S.kfrac === 0.25 ? '¼' : S.kfrac} Kelly on a $${S.bankroll} bankroll</p>
      ${s.ev < 0 ? '<div class="warnbox">Negative EV — Kelly says bet $0.</div>' : ''}
      ${same ? '<div class="warnbox">⚠ Two legs from the same game are correlated — the hit % is unreliable and many books will block it.</div>' : ''}
      ${reds.length ? `<div class="warnbox">🔴 Matchup data fades: ${reds.map(l => esc(l.pick)).join(', ')}</div>` : ''}
      <button class="btn" id="clearSlip">Clear slip</button>` : '<div class="empty">Tap <b>+ Slip</b> on any pick.</div>');
  }

  // ---------- settings + live refresh ----------
  function openSettings() {
    openDrawer('⚙️ Settings', `<div class="form">
      <label>The Odds API key <input id="sKey" type="password" value="${esc(S.key)}" placeholder="free at the-odds-api.com"></label>
      <label>Credits per live refresh <input id="sBudget" type="number" min="3" value="${esc(S.budget)}"></label>
      <p class="note">~3 credits per sport for lines, ~3–5 per game for props. Free tier = 500/month, shared with the daily build.</p>
      <label>Books I can bet <select id="sBooks"><option value="0">US books</option><option value="1" ${S.allBooks ? 'selected' : ''}>All books</option></select></label>
      <label>Bankroll ($) <input id="sBank" type="number" value="${esc(S.bankroll)}"></label>
      <label>Kelly fraction <select id="sKelly">${[[0.1, '1/10'], [0.25, '1/4'], [0.5, '1/2']].map(([v, l]) => `<option value="${v}" ${S.kfrac === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Theme <select id="sTheme"><option value="">Match system</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
      <button class="btn primary" id="saveSet">Save</button>
      ${store.get('liveCard', null) ? '<button class="btn" id="dropLive">Go back to the daily card</button>' : ''}
      <p class="note">Your key is stored only in this browser.</p></div>`);
    $('sTheme').value = store.get('theme', '');
  }
  async function liveRefresh() {
    if (!S.key) { openSettings(); return; }
    openDrawer('↻ Live refresh', `<p class="note">Pulling fresh lines + props (budget ${S.budget} credits)…</p><div class="log" id="log"></div>`);
    const log = m => { const el = $('log'); if (el) { el.textContent += m + '\n'; el.scrollTop = 1e9; } };
    const get = async url => { const r = await fetch(url); if (!r.ok) throw new Error(r.status + ''); return { json: await r.json(), headers: n => r.headers.get(n) }; };
    try {
      const c = await E.buildCard({ get, key: S.key, budget: S.budget, allowAll: S.allBooks, log });
      card = c; store.set('liveCard', c); index(); render();
      log('✅ Done — card updated.');
    } catch (e) { log('❌ ' + e.message); }
  }

  // ---------- drawer/modal plumbing ----------
  function openDrawer(title, html) { $('drawerTitle').textContent = title; $('drawerBody').innerHTML = html; $('drawer').classList.add('show'); $('overlay').classList.add('show'); }
  function closeAll() { $('drawer').classList.remove('show'); $('modal').classList.remove('show'); $('overlay').classList.remove('show'); }
  function applyTheme() { const t = store.get('theme', ''); if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-add],[data-open],[data-tab],[data-lg],[data-mk],[data-close],[data-loadparlay],#overlay,#slipbar,#liveBtn,#setBtn,#saveSet,#dropLive,#clearSlip,#buildBtn');
    if (!el) return;
    if (el.dataset.add) { e.stopPropagation(); toggleSlip(el.dataset.add); return; }
    if (el.dataset.open) { openDetail(el.dataset.open); return; }
    if (el.dataset.tab) { S.tab = el.dataset.tab; store.set('tab', S.tab); S.market = 'ALL'; render(); return; }
    if (el.dataset.lg) { S.lg = el.dataset.lg; S.market = 'ALL'; render(); return; }
    if (el.dataset.mk) { S.market = el.dataset.mk; render(); return; }
    if (el.dataset.loadparlay) { S.slip = el.dataset.loadparlay.split(','); store.set('slip', S.slip); render(); openSlip(); return; }
    if (el.hasAttribute('data-close') || el.id === 'overlay') { closeAll(); return; }
    switch (el.id) {
      case 'slipbar': openSlip(); break;
      case 'liveBtn': liveRefresh(); break;
      case 'setBtn': openSettings(); break;
      case 'clearSlip': S.slip = []; store.set('slip', []); render(); openSlip(); break;
      case 'dropLive': store.set('liveCard', null); try { localStorage.removeItem('edge.liveCard'); } catch (err) {} card = window.EDGE_CARD; index(); render(); closeAll(); break;
      case 'saveSet':
        S.key = $('sKey').value.trim(); S.budget = Math.max(3, +$('sBudget').value || 20); S.allBooks = $('sBooks').value === '1';
        S.bankroll = +$('sBank').value || 500; S.kfrac = +$('sKelly').value;
        ['key', 'budget', 'allBooks', 'bankroll', 'kfrac'].forEach(k => store.set(k, S[k]));
        store.set('theme', $('sTheme').value); applyTheme();
        if (card) { E.applyBooks([...card.lines, ...card.props], S.allBooks); }
        closeAll(); render(); break;
      case 'buildBtn': {
        const src = $('bsrc').value, lg = $('blg').value;
        const pool = E.parlayPool([...card.lines, ...card.props].filter(x => (src === 'all' || x.type === src) && (lg === 'ALL' || x.lg === lg)));
        const res = E.buildParlays(pool, +$('bk').value, $('brank').value, S.kfrac).slice(0, 6);
        built = res.length ? res.map((r, i) => parlayCard({ name: `Option ${i + 1}`, emoji: '🎟️', legs: r.legs.map(l => l.id) }, i === 0)).join('')
          : empty('Not enough +EV legs from different games for that many legs.');
        $('builtOut').innerHTML = built; break;
      }
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'q') { S.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('q'); q.focus(); q.setSelectionRange(pos, pos); }
  });
  document.addEventListener('change', e => { if (e.target.id === 'sort') { S.sort = e.target.value; render(); } });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

  applyTheme(); index(); render();
})();
