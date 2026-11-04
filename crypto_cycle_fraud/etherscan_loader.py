"""
Etherscan loader -- pulls REAL on-chain transfers and runs the cycle detector.
==============================================================================

How it works (the 10-second version):

    seed wallet ──fetch its txs──► its counterparties ──fetch their txs──► ...
        (depth 0)                     (depth 1)                (depth 2)

    We crawl outward from the wallet(s) you give us, collect every transfer
    between them, then hand the pile to `analyze()` from the detector.

Setup:
    1. Free API key: https://etherscan.io/myapikey
    2. export ETHERSCAN_API_KEY=yourkey
    3. Allow `api.etherscan.io` in your network settings (if sandboxed)

Usage:
    python3 etherscan_loader.py 0xSEEDWALLET
    python3 etherscan_loader.py 0xA 0xB --depth 2 --max-wallets 80
    python3 etherscan_loader.py 0xA --token 0xdAC17F958D2ee523a2206206994597C13D831ec7   # USDT
    python3 etherscan_loader.py --from-cache txs.json        # re-run offline, no API calls

Pure Python standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from typing import Callable

from cycle_fraud_detector import Transaction, analyze

API_URL = "https://api.etherscan.io/v2/api"
PAGE_SIZE = 1000          # rows per request (Etherscan max is 10,000 total per query)
FREE_TIER_DELAY = 0.21    # free tier = 5 calls/sec, so wait ~0.2s between calls

# Fetcher signature: (params dict) -> list of raw tx dicts. Swappable for tests.
Fetcher = Callable[[dict], list[dict]]


# ---------------------------------------------------------------------------
# 1. TALKING TO ETHERSCAN
# ---------------------------------------------------------------------------


class EtherscanError(RuntimeError):
    pass


def make_http_fetcher(api_key: str, chain_id: int = 1, retries: int = 4) -> Fetcher:
    """Returns a function that calls the Etherscan V2 API with rate-limit retries."""
    last_call = [0.0]

    def fetch(params: dict) -> list[dict]:
        query = {"chainid": chain_id, "apikey": api_key, **params}
        url = f"{API_URL}?{urllib.parse.urlencode(query)}"
        for attempt in range(retries + 1):
            wait = FREE_TIER_DELAY - (time.time() - last_call[0])
            if wait > 0:
                time.sleep(wait)
            last_call[0] = time.time()
            try:
                with urllib.request.urlopen(url, timeout=30) as resp:
                    body = json.load(resp)
            except OSError as e:
                if attempt == retries:
                    raise EtherscanError(f"network error: {e}") from e
                time.sleep(2 ** attempt)
                continue

            result = body.get("result")
            if body.get("status") == "1" and isinstance(result, list):
                return result
            msg = f"{body.get('message')}: {result}"
            if "No transactions found" in msg:
                return []
            if "rate limit" in msg.lower() and attempt < retries:
                time.sleep(2 ** attempt)
                continue
            raise EtherscanError(msg)
        return []

    return fetch


def fetch_wallet_txs(fetch: Fetcher, address: str, token: str | None = None) -> list[dict]:
    """Get one wallet's transfers: native ETH (txlist) or one ERC-20 token (tokentx)."""
    params = {
        "module": "account",
        "action": "tokentx" if token else "txlist",
        "address": address,
        "startblock": 0,
        "endblock": 99_999_999,
        "page": 1,
        "offset": PAGE_SIZE,
        "sort": "desc",        # newest first, so the cap keeps recent activity
    }
    if token:
        params["contractaddress"] = token
    return fetch(params)


# ---------------------------------------------------------------------------
# 2. RAW JSON ──► Transaction
# ---------------------------------------------------------------------------


def to_transaction(raw: dict) -> Transaction | None:
    """Convert an Etherscan row to our Transaction. Returns None for junk rows."""
    src = (raw.get("from") or "").lower()
    dst = (raw.get("to") or "").lower()
    if not src or not dst or src == dst:          # contract creation / self-send
        return None
    if raw.get("isError") == "1":                 # failed tx, no money moved
        return None
    decimals = int(raw.get("tokenDecimal") or 18) # ETH has 18 decimals
    amount = int(raw.get("value") or 0) / 10 ** decimals
    if amount <= 0:                               # 0-value contract calls
        return None
    tx_id = raw["hash"]
    if raw.get("logIndex"):                       # one tx can hold many token transfers
        tx_id = f"{tx_id}:{raw['logIndex']}"
    ts = datetime.fromtimestamp(int(raw["timeStamp"]), tz=timezone.utc).replace(tzinfo=None)
    return Transaction(tx_id, src, dst, amount, ts)


# ---------------------------------------------------------------------------
# 3. CRAWL OUTWARD FROM SEED WALLETS
# ---------------------------------------------------------------------------
#
#   depth 0:  [seed]
#   depth 1:  [seed] + top counterparties of seed
#   depth 2:  ... + top counterparties of those
#
#   "Hubs" (exchanges, DEX routers) have thousands of txs. We still record
#   their transfers but DON'T expand through them -- otherwise one Binance
#   wallet would drag in half of Ethereum.
# ---------------------------------------------------------------------------


def crawl(
    fetch: Fetcher,
    seeds: list[str],
    depth: int = 1,
    max_wallets: int = 50,
    token: str | None = None,
    log: Callable[[str], None] = print,
) -> tuple[list[dict], set[str]]:
    seeds = [s.lower() for s in seeds]
    visited: set[str] = set()
    hubs: set[str] = set()
    raw_rows: dict[str, dict] = {}
    frontier = list(dict.fromkeys(seeds))

    for level in range(depth + 1):
        next_counts: Counter[str] = Counter()
        for wallet in frontier:
            if wallet in visited or len(visited) >= max_wallets:
                continue
            visited.add(wallet)
            rows = fetch_wallet_txs(fetch, wallet, token)
            is_hub = len(rows) >= PAGE_SIZE
            if is_hub:
                hubs.add(wallet)
            log(f"  [depth {level}] {wallet}  {len(rows):>4} txs{'  (hub, not expanding)' if is_hub else ''}")
            for r in rows:
                key = f"{r.get('hash')}:{r.get('logIndex', '')}"
                raw_rows[key] = r
                t = to_transaction(r)                 # only follow REAL money moves
                if not is_hub and t is not None:
                    for other in (t.src, t.dst):
                        if other != wallet and other not in visited:
                            next_counts[other] += 1
        # expand toward the wallets we interact with MOST (loops = repeat contact)
        frontier = [w for w, _ in next_counts.most_common()]
        if not frontier:
            break
    return list(raw_rows.values()), visited


def rows_to_transactions(rows: list[dict], keep_wallets: set[str] | None = None) -> list[Transaction]:
    """Convert + optionally keep only transfers BETWEEN crawled wallets
    (a loop can only close through wallets whose history we actually fetched)."""
    txs = []
    for r in rows:
        t = to_transaction(r)
        if t is None:
            continue
        if keep_wallets is not None and not (t.src in keep_wallets and t.dst in keep_wallets):
            continue
        txs.append(t)
    txs.sort(key=lambda t: t.ts)
    return txs


# ---------------------------------------------------------------------------
# 4. CLI
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run cyclic fraud detection on real Etherscan data.")
    ap.add_argument("seeds", nargs="*", help="wallet address(es) to start crawling from")
    ap.add_argument("--depth", type=int, default=1, help="hops to crawl out from seeds (default 1)")
    ap.add_argument("--max-wallets", type=int, default=50, help="API-call budget (default 50)")
    ap.add_argument("--token", help="ERC-20 contract address (default: native ETH)")
    ap.add_argument("--chain-id", type=int, default=1, help="1=Ethereum, 56=BSC, 137=Polygon, ...")
    ap.add_argument("--threshold", type=float, default=70.0, help="risk score to flag (default 70)")
    ap.add_argument("--cache", default="txs.json", help="where to save fetched rows")
    ap.add_argument("--from-cache", help="skip the API, load rows from this JSON file")
    args = ap.parse_args(argv)

    if args.from_cache:
        with open(args.from_cache) as f:
            saved = json.load(f)
        rows, wallets = saved["rows"], set(saved["wallets"])
        print(f"📂 Loaded {len(rows)} cached rows for {len(wallets)} wallets from {args.from_cache}")
    else:
        if not args.seeds:
            ap.error("give at least one seed wallet, or --from-cache FILE")
        api_key = os.environ.get("ETHERSCAN_API_KEY")
        if not api_key:
            print("❌ Set ETHERSCAN_API_KEY first (free key: https://etherscan.io/myapikey)")
            return 1
        print(f"🕷️  Crawling from {len(args.seeds)} seed(s), depth {args.depth}, "
              f"budget {args.max_wallets} wallets...")
        try:
            rows, wallets = crawl(make_http_fetcher(api_key, args.chain_id),
                                  args.seeds, args.depth, args.max_wallets, args.token)
        except EtherscanError as e:
            print(f"❌ Etherscan said: {e}")
            return 1
        with open(args.cache, "w") as f:
            json.dump({"rows": rows, "wallets": sorted(wallets)}, f)
        print(f"💾 Saved {len(rows)} rows to {args.cache} (re-run with --from-cache {args.cache})\n")

    txs = rows_to_transactions(rows, keep_wallets=wallets)
    if not txs:
        print("🤷 No transfers between crawled wallets -- try --depth 2 or more seeds.")
        return 0
    analyze(txs, threshold=args.threshold)
    return 0


if __name__ == "__main__":
    sys.exit(main())
