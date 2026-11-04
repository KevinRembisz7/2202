"""Offline tests: fake Etherscan responses, no network or API key needed.
Run: python3 -m unittest test_etherscan_loader -v
"""
import io
import contextlib
import unittest

import etherscan_loader as el

A, B, C, D = (f"0x{c * 40}" for c in "abcd")
HUB = "0x" + "e" * 40
T0 = 1_760_000_000  # unix seconds


def row(h, src, dst, eth, t, **extra):
    return {"hash": h, "from": src, "to": dst, "value": str(int(eth * 10**18)),
            "timeStamp": str(t), "isError": "0", **extra}


# A -> B -> C -> A loop, 5 minutes apart, ~same amount  (fraud ring)
RING = [row("0x1", A, B, 10.0, T0), row("0x2", B, C, 9.98, T0 + 300), row("0x3", C, A, 9.95, T0 + 600),
        row("0x4", A, B, 10.0, T0 + 4000), row("0x5", B, C, 9.97, T0 + 4300), row("0x6", C, A, 9.96, T0 + 4600)]
JUNK = [row("0x7", A, D, 0, T0),                       # zero value
        row("0x8", A, D, 1.0, T0, isError="1"),        # failed
        row("0x9", A, "", 1.0, T0)]                    # contract creation


def fake_fetch_factory(calls):
    def fetch(params):
        addr = params["address"]
        calls.append(addr)
        if addr == HUB:
            return [row(f"0xh{i}", HUB, f"0x{i:040x}", 1, T0 + i) for i in range(el.PAGE_SIZE)]
        rows = [r for r in RING + JUNK if addr in (r["from"], r["to"])]
        if addr == A:
            rows.append(row("0xha", HUB, A, 5.0, T0 - 99))
        return rows
    return fetch


class LoaderTests(unittest.TestCase):
    def test_to_transaction_filters_junk(self):
        self.assertTrue(all(el.to_transaction(r) is None for r in JUNK))
        t = el.to_transaction(RING[0])
        self.assertEqual((t.src, t.dst, t.amount), (A, B, 10.0))

    def test_token_decimals_and_log_index(self):
        t = el.to_transaction(row("0xt", A, B, 0, T0, value="2500000", tokenDecimal="6", logIndex="7"))
        self.assertEqual(t.amount, 2.5)
        self.assertEqual(t.tx_id, "0xt:7")

    def test_crawl_finds_ring_and_skips_expanding_hub(self):
        calls = []
        rows, wallets = el.crawl(fake_fetch_factory(calls), [A], depth=2, log=lambda *_: None)
        self.assertEqual(wallets, {A, B, C, HUB})
        self.assertNotIn("0x" + "0" * 39 + "1", calls)   # hub's counterparties never fetched
        self.assertEqual(calls.count(A), 1)              # no duplicate API calls

    def test_end_to_end_flags_ring(self):
        rows, wallets = el.crawl(fake_fetch_factory([]), [A], depth=2, log=lambda *_: None)
        txs = el.rows_to_transactions(rows, keep_wallets=wallets)
        with contextlib.redirect_stdout(io.StringIO()):
            rings = el.analyze(txs, svg_path="/dev/null")
        self.assertEqual(rings, [{A, B, C}])

    def test_max_wallets_budget(self):
        calls = []
        el.crawl(fake_fetch_factory(calls), [A], depth=3, max_wallets=2, log=lambda *_: None)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
