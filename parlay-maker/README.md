# ⚡ Edge Lab

Daily +EV sports picks, **player props** and parlays. Every price is checked against the sharp no-vig line and backed by injuries, hit rates and matchup stats. A GitHub Action rebuilds the card every morning and publishes it to GitHub Pages.

## What's on the card
- **Game lines** (ML, spreads, totals): NFL, NBA, NHL, NCAAF, NCAAB, MLB, EPL, Champions League, MMA, plus any live ATP/WTA tournament. The fair price is Pinnacle's line with the vig removed (power de-vig).
- **Player props**: points, rebounds, assists, threes and PRA in basketball; passing, rushing and receiving yards plus receptions in football; shots, points and assists in hockey. The fair price is Pinnacle's no-vig line when Pinnacle offers the prop, otherwise the median no-vig line across 3+ books.
- **Hit rates**: each player's recent ESPN game log compared to tonight's line.
- **Vibe score**: ESPN's win model vs the market, injuries (whose absence opens up whose matchup), teammates out (who picks up the extra usage), form and a scoring projection.
- **Auto-built parlays**: Safe-ish, Value and Lotto, max one leg per game, no 🔴 fades. There's also a build-your-own tab.

## Files
| File | What it does |
|---|---|
| `index.html` + `app.js` | The UI. Works on GitHub Pages or straight from disk. |
| `engine.js` | Shared odds math, ESPN analysis and the `buildCard` pipeline (runs in Node and the browser). |
| `scripts/build.js` | Daily build → `data/latest.js` |
| `data/latest.js` | Today's card (committed by the daily job) |
| `../.github/workflows/daily-card.yml` | Every morning at 8:23 AM ET: build, commit, deploy to Pages |

## Setup (one time)
1. **Add the key:** repo **Settings → Secrets and variables → Actions → New repository secret**, name `ODDS_API_KEY`.
2. **Turn on Pages:** **Settings → Pages → Source: GitHub Actions**.
3. Merge to `main`. GitHub only runs scheduled workflows from the default branch.
4. Optional: run it now from **Actions → Daily Edge Card → Run workflow**.
5. Optional: set a repo variable `DAILY_BUDGET` to fix the credits spent per day.

## Credit budget
With the default `auto` budget, each run spends `credits left ÷ days left in the month`.

| Pull | Cost |
|---|---|
| Lines, per sport | ~3 credits (Pinnacle + 9 US books = one region) |
| Props, per game | ~3–5 credits |

**Free tier (500/mo):** about 15 credits a day. That covers lines for ~4 sports plus props for about 1–2 games.

**$30/mo tier (20K):** about 650 credits a day. That covers every sport plus props for every game in the next 30 hours.

## Local
```bash
ODDS_API_KEY=xxx node scripts/build.js --budget 40   # spend 40 credits
node scripts/build.js --reanalyze                    # refresh ESPN analysis only (free)
open index.html
```
The in-app **↻ Live refresh** runs the same pipeline in your browser with your key, saved only in that browser.

Not betting advice. Edges are small, variance is huge, and books limit winners. 1-800-GAMBLER.
