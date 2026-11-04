# Crypto Cyclic Transaction Fraud Detection — Demo

Detects **wash trading / round-tripping**: crypto sent around a loop of wallets
(`A → B → C → D → A`) to fake volume or launder funds.

```bash
python3 cycle_fraud_detector.py   # pure stdlib, no installs
```

## Pipeline

```
 transactions ──► directed graph ──► temporal cycle search ──► risk score ──► fraud rings
 (src,dst,amt,ts)  wallets = nodes    each hop later than last   0..100       + SVG picture
                   txs = edges        all within 3-day window
```

## Risk score (0–100)

| Signal              | Max pts | Why it's sus                                   |
|---------------------|---------|------------------------------------------------|
| Amount preservation | 40      | same money keeps going round (only fees lost)  |
| Speed               | 30      | loop closes in minutes, not days               |
| Loop length         | 15      | more hops = deliberate layering                |
| Burner wallets      | 15      | low-activity / fresh addresses                 |

Cycles scoring ≥ 70 get flagged. Flagged cycles that share wallets are merged into rings.

## Output

Prints each ring with a reason for the flag, lists low-score legit loops (including a
planted "friends splitting rent" decoy), shows precision and recall against the planted
ground truth, and writes `fraud_rings.svg`.

![rings](fraud_rings.svg)

## Real data: Etherscan

```
seed wallet ──fetch txs──► top counterparties ──fetch txs──► ... ──► analyze()
  depth 0                     depth 1                                  same detector
```

1. Get a free API key at https://etherscan.io/myapikey
2. `export ETHERSCAN_API_KEY=yourkey`
3. If you're in a sandbox, allow `api.etherscan.io` in its network settings.

```bash
python3 etherscan_loader.py 0xSEEDWALLET                       # native ETH, crawl 1 hop out
python3 etherscan_loader.py 0xA 0xB --depth 2 --max-wallets 80 # wider crawl
python3 etherscan_loader.py 0xA --token 0xdAC17F958D2ee523a2206206994597C13D831ec7  # USDT only
python3 etherscan_loader.py 0xA --chain-id 56                  # BSC (any Etherscan V2 chain)
python3 etherscan_loader.py --from-cache txs.json              # re-run offline, 0 API calls
```

- Each crawled wallet costs one API call (`--max-wallets` caps the total). Calls are throttled to the free tier's 5 per second, with retries on rate limits.
- **Hubs** (wallets with 1000 or more txs, like exchanges and DEX routers) are recorded but not crawled through.
- Failed, zero-value, and contract-creation txs are dropped.
- Only transfers between crawled wallets are analyzed, because a loop can only close through wallets whose history was fetched.

Offline tests (fake Etherscan responses): `python3 -m unittest test_etherscan_loader -v`

## Next steps
- Handle token swaps and DEX hops (value changes asset mid-loop).
- Swap the hand-tuned score for an ML model (GNN or gradient boosting) trained on these cycle features.
