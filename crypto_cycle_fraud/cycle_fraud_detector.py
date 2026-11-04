"""
Crypto Cyclic Transaction Fraud Detection -- DEMO
==================================================

Big idea (the 10-second version):
    Fraudsters "wash" money or fake trading volume by sending crypto around
    a LOOP of wallets that they secretly control:

        A ──> B ──> C ──> D ──> A      (money comes back home!)

    Real users almost never do this fast, with near-identical amounts.
    So we:
        1. Build a directed graph of wallets (nodes) and transfers (edges).
        2. Find TEMPORAL cycles: loops where every hop happens AFTER the
           previous one, all inside a short time window.
        3. Score each loop on "how fishy" it looks.
        4. Flag the high scorers.

Pure Python standard library only -- no installs needed.
Run:  python3 cycle_fraud_detector.py
"""

from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta

# ---------------------------------------------------------------------------
# 1. DATA MODEL
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Transaction:
    tx_id: str
    src: str          # sending wallet
    dst: str          # receiving wallet
    amount: float     # in ETH (or any token)
    ts: datetime      # block timestamp


@dataclass
class Cycle:
    txs: list[Transaction]
    score: float = 0.0
    reasons: list[str] = field(default_factory=list)

    @property
    def wallets(self) -> list[str]:
        return [t.src for t in self.txs]

    @property
    def duration(self) -> timedelta:
        return self.txs[-1].ts - self.txs[0].ts


# ---------------------------------------------------------------------------
# 2. SYNTHETIC DATA (normal traffic + hidden fraud rings + a benign decoy)
# ---------------------------------------------------------------------------

START = datetime(2026, 1, 1)


def addr(i: int) -> str:
    return f"0x{i:04x}"


def generate_transactions(seed: int = 7) -> tuple[list[Transaction], list[set[str]]]:
    rng = random.Random(seed)
    txs: list[Transaction] = []
    counter = 0

    def add(src, dst, amount, ts):
        nonlocal counter
        counter += 1
        txs.append(Transaction(f"tx{counter:05d}", src, dst, round(amount, 6), ts))

    # --- normal users: 60 wallets, random payments over 30 days -----------
    normal = [addr(i) for i in range(60)]
    for _ in range(900):
        s, d = rng.sample(normal, 2)
        add(s, d, rng.lognormvariate(0, 1.2), START + timedelta(minutes=rng.randint(0, 30 * 24 * 60)))

    # --- fraud rings: fresh wallets, fast hops, tiny "fee" skimmed each hop
    truth: list[set[str]] = []
    next_id = 1000
    for ring_len, amount in [(3, 50.0), (4, 120.0), (5, 75.0), (6, 300.0)]:
        ring = [addr(next_id + k) for k in range(ring_len)]
        next_id += ring_len
        truth.append(set(ring))
        t = START + timedelta(minutes=rng.randint(0, 29 * 24 * 60))
        for rep in range(rng.randint(2, 3)):          # wash it a few times
            amt = amount
            for k in range(ring_len):
                t += timedelta(minutes=rng.randint(1, 12))
                amt *= 1 - rng.uniform(0.001, 0.01)   # gas / fee loss
                add(ring[k], ring[(k + 1) % ring_len], amt, t)
            t += timedelta(hours=rng.randint(1, 6))
        # ring wallets also touch one normal wallet so they don't look isolated
        add(rng.choice(normal), ring[0], amount, START - timedelta(days=1))

    # --- benign decoy: friends splitting rent, slow & uneven amounts -------
    a, b, c = normal[1], normal[2], normal[3]
    add(a, b, 400.0, START + timedelta(days=3))
    add(b, c, 37.5, START + timedelta(days=3, hours=20))
    add(c, a, 120.0, START + timedelta(days=5))

    txs.sort(key=lambda t: t.ts)
    return txs, truth


# ---------------------------------------------------------------------------
# 3. TEMPORAL CYCLE DETECTION
# ---------------------------------------------------------------------------
#
#   For every transaction e0 = (start -> x) we do a DFS that only follows
#   transactions that are:
#       * LATER than the previous hop          (time flows forward)
#       * within `window` of e0                (it happened fast)
#       * to a wallet not yet on the path      (simple cycle)
#   If we land back on `start` we found a cycle.
#
#   time ─────────────────────────────────────────────►
#   e0: A→B   e1: B→C   e2: C→D   e3: D→A   ✅ cycle
#   e0: A→B   e1: C→A (earlier than e0)     ❌ not temporal
# ---------------------------------------------------------------------------


def build_graph(txs: list[Transaction]) -> dict[str, list[Transaction]]:
    out_edges: dict[str, list[Transaction]] = defaultdict(list)
    for t in txs:
        out_edges[t.src].append(t)
    for edges in out_edges.values():
        edges.sort(key=lambda t: t.ts)
    return out_edges


def find_temporal_cycles(
    txs: list[Transaction],
    max_len: int = 6,
    window: timedelta = timedelta(days=3),
) -> list[Cycle]:
    graph = build_graph(txs)
    seen: set[frozenset[str]] = set()
    cycles: list[Cycle] = []

    def dfs(start: str, path: list[Transaction], visited: set[str]):
        last = path[-1]
        deadline = path[0].ts + window
        for nxt in graph.get(last.dst, []):
            if nxt.ts <= last.ts:
                continue
            if nxt.ts > deadline:
                break                                   # edges are time-sorted
            if nxt.dst == start:
                key = frozenset(t.tx_id for t in path + [nxt])
                if key not in seen:
                    seen.add(key)
                    cycles.append(Cycle(path + [nxt]))
            elif nxt.dst not in visited and len(path) + 1 < max_len:
                visited.add(nxt.dst)
                dfs(start, path + [nxt], visited)
                visited.remove(nxt.dst)

    for e0 in txs:
        if e0.src != e0.dst:
            dfs(e0.src, [e0], {e0.src, e0.dst})
    return cycles


# ---------------------------------------------------------------------------
# 4. RISK SCORING  (0 = chill, 100 = sus as hell)
# ---------------------------------------------------------------------------


def score_cycle(c: Cycle, wallet_degree: dict[str, int]) -> Cycle:
    amounts = [t.amount for t in c.txs]
    score = 0.0

    # (a) Amount preservation: same money keeps flowing round the loop
    retention = min(amounts) / max(amounts)
    pts = 40 * retention
    score += pts
    if retention > 0.9:
        c.reasons.append(f"amount preserved {retention:.1%} around loop")

    # (b) Speed: whole loop completes quickly
    hours = c.duration.total_seconds() / 3600
    pts = 30 * max(0.0, 1 - hours / 24)
    score += pts
    if hours < 2:
        c.reasons.append(f"loop closed in {hours * 60:.0f} min")

    # (c) Loop length: longer loops = more deliberate layering
    if len(c.txs) >= 3:
        score += min(15, 5 * (len(c.txs) - 2))
        c.reasons.append(f"{len(c.txs)}-hop layering")

    # (d) Low-activity wallets (fresh / burner accounts)
    avg_deg = sum(wallet_degree[w] for w in c.wallets) / len(c.wallets)
    pts = 15 * max(0.0, 1 - avg_deg / 40)
    score += pts
    if avg_deg < 15:
        c.reasons.append(f"burner-like wallets (avg {avg_deg:.0f} txs)")

    c.score = round(score, 1)
    return c


# ---------------------------------------------------------------------------
# 5. REPORTING + VISUALS
# ---------------------------------------------------------------------------


def ascii_ring(c: Cycle) -> str:
    parts = []
    for t in c.txs:
        parts.append(f"{t.src} ─[{t.amount:.2f}]→ ")
    return "".join(parts) + c.txs[0].src + "  (back home 🔁)"


def score_bar(score: float, width: int = 30) -> str:
    filled = int(score / 100 * width)
    return "█" * filled + "░" * (width - filled)


def merge_rings(cycles: list[Cycle]) -> list[set[str]]:
    """Group flagged cycles that share wallets into fraud rings."""
    rings: list[set[str]] = []
    for c in cycles:
        ws = set(c.wallets)
        for r in rings:
            if r & ws:
                r |= ws
                break
        else:
            rings.append(ws)
    return rings


def write_svg(rings: list[set[str]], cycles: list[Cycle], path: str) -> None:
    """Draw each detected ring as a circle of wallets with arrows."""
    import math

    w, h = 260 * max(1, len(rings)), 300
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
           'font-family="monospace" font-size="11">',
           '<rect width="100%" height="100%" fill="#111"/>',
           '<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" '
           'orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="#ff5c5c"/></marker></defs>']
    for i, ring in enumerate(rings):
        cyc = next(c for c in cycles if set(c.wallets) <= ring)
        order = cyc.wallets
        cx, cy, r = 130 + i * 260, 150, 85
        pos = {wl: (cx + r * math.cos(2 * math.pi * k / len(order) - math.pi / 2),
                    cy + r * math.sin(2 * math.pi * k / len(order) - math.pi / 2))
               for k, wl in enumerate(order)}
        for t in cyc.txs:
            (x1, y1), (x2, y2) = pos[t.src], pos[t.dst]
            dx, dy = x2 - x1, y2 - y1
            d = math.hypot(dx, dy) or 1
            out.append(f'<line x1="{x1 + dx / d * 18:.1f}" y1="{y1 + dy / d * 18:.1f}" '
                       f'x2="{x2 - dx / d * 20:.1f}" y2="{y2 - dy / d * 20:.1f}" stroke="#ff5c5c" '
                       'stroke-width="2" marker-end="url(#arr)"/>')
            out.append(f'<text x="{(x1 + x2) / 2:.1f}" y="{(y1 + y2) / 2:.1f}" fill="#ffd166" '
                       f'text-anchor="middle">{t.amount:.1f}</text>')
        for wl, (x, y) in pos.items():
            out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="16" fill="#2b2d42" stroke="#8ecae6"/>')
            out.append(f'<text x="{x:.1f}" y="{y + 4:.1f}" fill="#fff" text-anchor="middle">{wl[-3:]}</text>')
        out.append(f'<text x="{cx}" y="25" fill="#fff" text-anchor="middle">Ring {i + 1} '
                   f'· score {cyc.score}</text>')
    out.append("</svg>")
    with open(path, "w") as f:
        f.write("\n".join(out))


# ---------------------------------------------------------------------------
# 6. MAIN
# ---------------------------------------------------------------------------


def analyze(
    txs: list[Transaction],
    truth: list[set[str]] | None = None,
    threshold: float = 70.0,
    svg_path: str = "fraud_rings.svg",
) -> list[set[str]]:
    """Run the full pipeline on any list of Transactions. Returns fraud rings."""
    print(f"📦 Loaded {len(txs)} transactions across "
          f"{len({t.src for t in txs} | {t.dst for t in txs})} wallets\n")

    degree: dict[str, int] = defaultdict(int)
    for t in txs:
        degree[t.src] += 1
        degree[t.dst] += 1

    # Cast a WIDE net (3 days) so legit loops get caught too -- then let the
    # scoring step separate the sus ones from the chill ones.
    cycles = find_temporal_cycles(txs, max_len=6, window=timedelta(days=3))
    cycles = [score_cycle(c, degree) for c in cycles]
    cycles.sort(key=lambda c: c.score, reverse=True)
    print(f"🔍 Found {len(cycles)} temporal cycles (≤6 hops, ≤3 day window)\n")

    flagged = [c for c in cycles if c.score >= threshold]
    rings = merge_rings(flagged)
    print(f"🚨 {len(flagged)} cycles scored ≥ {threshold}, merged into "
          f"{len(rings)} fraud rings. Top loop per ring:\n")
    for i, r in enumerate(rings, 1):
        c = next(c for c in flagged if set(c.wallets) <= r)   # highest score
        n = sum(1 for x in flagged if set(x.wallets) <= r)
        print(f"  Ring {i}  ({len(r)} wallets, {n} loops)  score {c.score:5.1f} {score_bar(c.score)}")
        print(f"    {ascii_ring(c)}")
        print(f"    why: {'; '.join(c.reasons)}\n")

    print("✅ Top low-score cycles (probably legit -- slow, uneven amounts):")
    ring_wallets = set().union(*rings) if rings else set()
    legit = [c for c in cycles if c.score < threshold and not set(c.wallets) & ring_wallets]
    for c in legit[:5]:
        amts = ", ".join(f"{t.amount:.1f}" for t in c.txs)
        print(f"  score {c.score:5.1f} {score_bar(c.score)}  "
              f"{' → '.join(c.wallets)}  [{amts}] over {c.duration}")
    decoy = next((c for c in cycles if set(c.wallets) == {"0x0001", "0x0002", "0x0003"}), None)
    if decoy:
        print(f"\n  👀 The planted 'friends splitting rent' loop scored {decoy.score} -- correctly NOT flagged")

    # --- evaluate against ground truth (only for synthetic data) ----------
    if truth:
        true_wallets = set().union(*truth)
        tp = len(ring_wallets & true_wallets)
        precision = tp / len(ring_wallets) if ring_wallets else 0
        recall = tp / len(true_wallets)
        print(f"\n📊 Wallet-level precision {precision:.0%} | recall {recall:.0%} "
              f"({tp}/{len(true_wallets)} fraud wallets caught)")

    if rings:
        write_svg(rings, flagged, svg_path)
        print(f"🖼️  Wrote {svg_path} (open it in a browser)")
    return rings


def main() -> None:
    txs, truth = generate_transactions()
    analyze(txs, truth)


if __name__ == "__main__":
    main()
