# Edge Parlay Lab

Single-file parlay builder that finds +EV legs by comparing each sportsbook's best price to a sharp book's de-vigged (no-vig) line.

- Open `index.html` in a browser.
- Paste a free API key from https://the-odds-api.com, pick a sport, and hit **Fetch odds**. Or hit **Load demo data** to try it with made-up numbers.
- Add +EV legs to your slip, or let **Auto-build** rank 2–5 leg parlays by Kelly growth, EV, or hit chance.

Math: power de-vig (avoids overrating longshots) → fair win %; leg EV = p·decimal − 1; parlay p and odds multiply; stake = fractional Kelly.
Only one leg per game goes into an auto-built parlay, since legs from the same game are correlated.
