# Edge Parlay Lab

Single-file parlay builder. It finds +EV legs by comparing each sportsbook's best price to a sharp book's no-vig line, then tells you *why* the leg looks good or bad using ESPN matchup data.

## Use it
- Open `index.html` in a browser (desktop or phone).
- Paste a free API key from https://the-odds-api.com, pick a sport (or all four big ones), and hit **Fetch odds**. Or hit **Load demo data** to try it with made-up numbers.
- **Tap any leg** for the breakdown: ESPN's win-probability model next to the market, injuries, season stats, last 5 games, team leaders, and "who cooks who" notes (e.g. a team missing two corners → the other team's top receiver).
- **🧠 Scan matchups** gives every shown leg a vibe: 🟢 the matchup backs the edge, 🟡 mixed, 🔴 fade.
- **Auto-build** ranks 2–5 leg parlays by Kelly growth, EV, hit chance or vibe, and can skip 🔴 legs.

## Math
- Power de-vig of the sharp line gives the fair win %. Unlike proportional de-vig, it doesn't overrate longshots.
- Leg EV = p × decimal odds − 1. For a parlay, the win chances and the odds multiply.
- Stake = fractional Kelly.
- Edges over 15% are flagged as probably a stale or bad line and left out of auto-built parlays.
- Only US books count by default.
- Max one leg per game in auto-built parlays, since legs from the same game are correlated.

Odds come from The Odds API (your key, stored only in your browser). Stats and injuries come from ESPN's public site API, which needs no key.
