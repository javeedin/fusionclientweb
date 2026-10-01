#!/usr/bin/env python3
"""
Re-ERP Procurement RD v1.0 - executable simulation (Appendix A).

Implements the quantity ledger, receiving, 2-way / 3-way matching with holds,
price and exchange variances, returns, cancellation, period-end accrual and
closure exactly as specified in PO_Module_Requirements_Design.md sections 5-7,
then runs worked examples A-E and asserts the invariants:

  * every journal balances (functional currency)
  * GRNI (receipt accrual) returns to zero after full matching
  * invoice_func = base_func + IPV + ERV on every match
  * closure statuses follow section 6.8
  * over-receipt is rejected, over-billing and price variance raise holds

Pure Python, no dependencies:  python3 docs/design/po_rd_simulation.py
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal as D, ROUND_HALF_UP

CENT = D("0.01")


def r2(x: D) -> D:
    return x.quantize(CENT, rounding=ROUND_HALF_UP)


# ── GL ───────────────────────────────────────────────────────────────────────
@dataclass
class Journal:
    event: str
    jdate: date
    lines: list[tuple[str, D, D]] = field(default_factory=list)   # (account, dr, cr)

    def add(self, account: str, amount: D):
        """positive = debit, negative = credit"""
        amount = r2(amount)
        if amount > 0:
            self.lines.append((account, amount, D(0)))
        elif amount < 0:
            self.lines.append((account, D(0), -amount))

    def balanced(self) -> bool:
        return sum(l[1] for l in self.lines) == sum(l[2] for l in self.lines)


class Ledger:
    def __init__(self):
        self.journals: list[Journal] = []

    def post(self, j: Journal):
        assert j.balanced(), f"unbalanced journal {j.event}: {j.lines}"
        self.journals.append(j)

    def balance(self, account: str, as_of: date | None = None) -> D:
        return sum((dr - cr for j in self.journals if as_of is None or j.jdate <= as_of
                    for a, dr, cr in j.lines if a == account), D(0))


# ── Model (section 5.2) ──────────────────────────────────────────────────────
@dataclass
class Distribution:
    qty_ordered: D
    charge_account: str
    accrual_account: str
    variance_account: str
    qty_delivered: D = D(0)
    qty_billed: D = D(0)
    qty_cancelled: D = D(0)
    accrued_func: D = D(0)
    events: list[tuple[date, str, D]] = field(default_factory=list)   # (date, kind, qty) for as-of queries


@dataclass
class Schedule:
    line_type: str            # QUANTITY / AMOUNT (amount lines use qty = amount, price = 1)
    price: D
    currency: str
    po_rate: D
    match_level: str          # TWO_WAY / THREE_WAY
    accrue_at_receipt: bool
    dists: list[Distribution]
    over_receipt_tol: D = D(0)
    inv_qty_tol: D = D(0)
    inv_price_tol: D = D(0)
    rcv_close_tol: D = D(0)
    inv_close_tol: D = D(0)
    final_closed: bool = False

    @property
    def ordered(self): return sum((d.qty_ordered for d in self.dists), D(0))
    @property
    def cancelled(self): return sum((d.qty_cancelled for d in self.dists), D(0))
    @property
    def received(self): return sum((d.qty_delivered for d in self.dists), D(0))
    @property
    def billed(self): return sum((d.qty_billed for d in self.dists), D(0))

    # section 6.8
    def closure(self) -> str:
        if self.final_closed:
            return "FINALLY_CLOSED"
        net = self.ordered - self.cancelled
        basis = self.received if self.match_level == "THREE_WAY" else net
        rcv_done = self.received >= net * (1 - self.rcv_close_tol) or (
            self.match_level == "TWO_WAY" and self.billed >= net * (1 - self.rcv_close_tol))
        inv_done = self.billed >= basis * (1 - self.inv_close_tol) and basis > 0 or (net == 0)
        if rcv_done and inv_done:
            return "CLOSED"
        if rcv_done:
            return "CLOSED_FOR_RECEIVING"
        if inv_done:
            return "CLOSED_FOR_INVOICING"
        return "OPEN"


class BusinessRule(Exception):
    pass


def prorate(total: D, weights: list[D]) -> list[D]:
    """split total by weights; last element absorbs rounding (MAT-08 / 5.4)"""
    s = sum(weights)
    out, acc = [], D(0)
    for i, w in enumerate(weights):
        part = total - acc if i == len(weights) - 1 else (total * w / s)
        out.append(part)
        acc += part
    return out


# ── Receiving (6.5) and accounting (7.3) ─────────────────────────────────────
def receive(gl: Ledger, s: Schedule, qty: D, on: date, reject_over: bool = True):
    limit = (s.ordered - s.cancelled) * (1 + s.over_receipt_tol)
    if s.received + qty > limit and reject_over:
        raise BusinessRule(f"RCV-07 over-receipt: {s.received + qty} > {limit}")
    open_w = [d.qty_ordered - d.qty_cancelled - d.qty_delivered for d in s.dists]
    parts = prorate(qty, open_w if sum(open_w) > 0 else [D(1)] * len(s.dists))
    j = Journal("PO_RECEIVE", on)
    for d, q in zip(s.dists, parts):
        d.qty_delivered += q
        d.events.append((on, "RCV", q))
        if s.accrue_at_receipt:
            amt = r2(q * s.price * s.po_rate)
            d.accrued_func += amt
            j.add(d.charge_account, amt)
            j.add(d.accrual_account, -amt)
    if j.lines:
        gl.post(j)


def return_to_supplier(gl: Ledger, s: Schedule, qty: D, on: date):
    unbilled_received = s.received - s.billed
    if qty > unbilled_received:
        raise BusinessRule(f"RCV-08 return {qty} > received-not-billed {unbilled_received}")
    parts = prorate(qty, [d.qty_delivered - d.qty_billed for d in s.dists])
    j = Journal("PO_RETURN", on)
    for d, q in zip(s.dists, parts):
        d.qty_delivered -= q
        d.events.append((on, "RCV", -q))
        if s.accrue_at_receipt:
            amt = r2(q * s.price * s.po_rate)
            d.accrued_func -= amt
            j.add(d.accrual_account, amt)
            j.add(d.charge_account, -amt)
    if j.lines:
        gl.post(j)


def cancel_remaining(s: Schedule):
    for d in s.dists:
        d.qty_cancelled = d.qty_ordered - max(d.qty_delivered, d.qty_billed)


# ── Matching (6.6) ───────────────────────────────────────────────────────────
@dataclass
class MatchResult:
    base: D
    ipv: D
    erv: D
    tax: D
    liability: D
    holds: list[str]


def match_invoice(gl: Ledger, s: Schedule, qty: D, inv_price: D, inv_rate: D, tax_pct: D, on: date,
                  liability_acct="AP_LIABILITY", tax_acct="INPUT_VAT",
                  erv_gain="ERV_GAIN", erv_loss="ERV_LOSS") -> MatchResult:
    if s.final_closed:
        raise BusinessRule("MAT-03 schedule finally closed")
    if s.match_level == "THREE_WAY" and s.billed + qty > s.received:
        # beyond the receipt itself is an error only when nothing is left to bill; within tolerance => hold
        pass
    parts = prorate(qty, [d.qty_ordered - d.qty_cancelled for d in s.dists])
    j = Journal("AP_INVOICES", on)
    base_t = ipv_t = erv_t = D(0)
    for d, q in zip(s.dists, parts):
        base_rate = s.po_rate                      # receipt rate = PO rate (receipts accrue at PO rate)
        base = r2(q * s.price * base_rate)
        ipv = r2(q * (inv_price - s.price) * inv_rate)
        inv_func = r2(q * inv_price * inv_rate)
        erv = inv_func - base - ipv                # identity, rounding absorbed in ERV
        debit = d.accrual_account if s.accrue_at_receipt else d.charge_account
        j.add(debit, base)
        j.add(d.variance_account, ipv)
        j.add(erv_loss if erv > 0 else erv_gain, erv)
        if s.accrue_at_receipt:
            d.accrued_func -= base
        d.qty_billed += q
        d.events.append((on, "BILL", q))
        base_t += base; ipv_t += ipv; erv_t += erv
        assert inv_func == base + ipv + erv, "invoice = base + IPV + ERV"
    tax = r2(qty * inv_price * tax_pct / 100 * inv_rate)
    j.add(tax_acct, tax)
    liability = base_t + ipv_t + erv_t + tax
    j.add(liability_acct, -liability)
    gl.post(j)
    return MatchResult(base_t, ipv_t, erv_t, tax, liability, validate_holds(s, inv_price))


def validate_holds(s: Schedule, inv_price: D) -> list[str]:
    """6.6.3 - evaluated over all matched invoices of the schedule"""
    holds = []
    if s.billed > (s.ordered - s.cancelled) * (1 + s.inv_qty_tol):
        holds.append("QTY_ORD")
    if s.match_level == "THREE_WAY" and s.billed > s.received * (1 + s.inv_qty_tol):
        holds.append("QTY_REC")
    if s.line_type == "QUANTITY" and inv_price > s.price * (1 + s.inv_price_tol):
        holds.append("PRICE")
    return holds


# ── Period-end accrual (6.7.2) ───────────────────────────────────────────────
def period_end_accrual(gl: Ledger, schedules: list[Schedule], period_end: date, reversal: date) -> D:
    total = D(0)
    j = Journal("PO_PERIOD_END_ACCRUAL", period_end)
    rv = Journal("PO_PERIOD_END_ACCRUAL_REVERSAL", reversal)
    for s in schedules:
        if s.accrue_at_receipt:
            continue
        for d in s.dists:
            delivered = sum((q for dt, k, q in d.events if k == "RCV" and dt <= period_end), D(0))
            billed = sum((q for dt, k, q in d.events if k == "BILL" and dt <= period_end), D(0))
            unbilled = delivered - billed
            if unbilled > 0:
                amt = r2(unbilled * s.price * s.po_rate)
                total += amt
                j.add(d.charge_account, amt); j.add(d.accrual_account, -amt)
                rv.add(d.accrual_account, amt); rv.add(d.charge_account, -amt)
    if j.lines:
        gl.post(j); gl.post(rv)
    return total


# ── Scenarios (section 7.4) ──────────────────────────────────────────────────
def dist(qty, charge, accrual="GRNI", variance=None):
    return Distribution(D(qty), charge, accrual, variance or charge)


results: list[str] = []


def check(name: str, cond: bool, detail: str = ""):
    results.append(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")
    assert cond, f"{name}: {detail}"


def example_a():
    print("A. Office chairs - quantity line, 3-way, receipt accrual")
    gl = Ledger()
    s = Schedule("QUANTITY", D("450"), "AED", D(1), "THREE_WAY", True,
                 [dist(20, "6105001-FURNITURE")], inv_price_tol=D("0.05"))
    try:
        receive(gl, s, D(21), date(2026, 10, 5))
        check("over-receipt 21 of 20 rejected", False)
    except BusinessRule as e:
        check("over-receipt 21 of 20 rejected", True, str(e))
    receive(gl, s, D(20), date(2026, 10, 5))
    check("receipt accrual Dr expense / Cr GRNI 9,000.00", gl.balance("GRNI") == D("-9000.00"))
    m = match_invoice(gl, s, D(20), D("460"), D(1), D(5), date(2026, 10, 9))
    check("invoice 20 x 460 + VAT = 9,660.00", m.liability == D("9660.00"), f"liability {m.liability}")
    check("IPV 200.00 to expense, ERV 0", m.ipv == D("200.00") and m.erv == 0)
    check("price +2.2% within 5% tolerance - no hold", m.holds == [], str(m.holds))
    check("GRNI cleared to 0.00", gl.balance("GRNI") == 0 and s.dists[0].accrued_func == 0)
    check("expense = 9,200.00 (actual price)", gl.balance("6105001-FURNITURE") == D("9200.00"))
    check("schedule CLOSED", s.closure() == "CLOSED", s.closure())
    check("all journals balanced", all(j.balanced() for j in gl.journals))


def example_a_holds():
    print("A2. Holds - over-billing and price variance")
    gl = Ledger()
    s = Schedule("QUANTITY", D("450"), "AED", D(1), "THREE_WAY", True,
                 [dist(20, "6105001-FURNITURE")], inv_price_tol=D("0.05"))
    receive(gl, s, D(10), date(2026, 10, 5))
    m = match_invoice(gl, s, D(12), D("480"), D(1), D(5), date(2026, 10, 9))
    check("billed 12 > received 10 -> QTY_REC hold", "QTY_REC" in m.holds, str(m.holds))
    check("480 vs 450 (+6.7%) > 5% -> PRICE hold", "PRICE" in m.holds, str(m.holds))
    receive(gl, s, D(2), date(2026, 10, 12))
    check("after receiving 2 more, QTY_REC releases", "QTY_REC" not in validate_holds(s, D("480")))
    check("12 received = 12 billed -> CLOSED_FOR_INVOICING (3-way)", s.closure() == "CLOSED_FOR_INVOICING",
          s.closure())
    receive(gl, s, D(3), date(2026, 10, 14))
    check("receiving 3 more re-opens it for invoicing -> OPEN", s.closure() == "OPEN", s.closure())
    check("all journals balanced", all(j.balanced() for j in gl.journals))


def example_b():
    print("B. AC maintenance - amount line, 2-way, quarterly schedules")
    gl = Ledger()
    quarters = [Schedule("AMOUNT", D(1), "AED", D(1), "TWO_WAY", False, [dist(3000, "6201001-REPAIRS")])
                for _ in range(4)]
    m = match_invoice(gl, quarters[0], D(3000), D(1), D(1), D(5), date(2026, 10, 10))
    check("Q1 invoice 3,000 + VAT 150 = 3,150.00", m.liability == D("3150.00"), f"{m.liability}")
    check("expense 3,000.00 (no accrual account used)", gl.balance("6201001-REPAIRS") == D("3000.00"))
    check("Q1 schedule CLOSED by billing (2-way)", quarters[0].closure() == "CLOSED", quarters[0].closure())
    check("Q2-Q4 still OPEN", all(q.closure() == "OPEN" for q in quarters[1:]))
    check("all journals balanced", all(j.balanced() for j in gl.journals))


def example_c():
    print("C. Software licences - USD PO, receipt accrual, exchange variance")
    gl = Ledger()
    s = Schedule("QUANTITY", D("120"), "USD", D("3.6725"), "THREE_WAY", True, [dist(10, "6107001-SOFTWARE")])
    receive(gl, s, D(10), date(2026, 10, 2))
    check("receipt at PO rate: 1,200 x 3.6725 = 4,407.00", gl.balance("GRNI") == D("-4407.00"))
    m = match_invoice(gl, s, D(10), D("120"), D("3.68"), D(5), date(2026, 10, 20))
    check("ERV loss 9.00", m.erv == D("9.00") and gl.balance("ERV_LOSS") == D("9.00"), f"{m.erv}")
    check("VAT 60 USD x 3.68 = 220.80", m.tax == D("220.80"), f"{m.tax}")
    check("liability 1,260 USD x 3.68 = 4,636.80", m.liability == D("4636.80"), f"{m.liability}")
    check("GRNI cleared", gl.balance("GRNI") == 0)
    check("all journals balanced", all(j.balanced() for j in gl.journals))


def example_d():
    print("D. Return before invoicing, then cancel the remainder")
    gl = Ledger()
    s = Schedule("QUANTITY", D("450"), "AED", D(1), "THREE_WAY", True, [dist(20, "6105001-FURNITURE")])
    receive(gl, s, D(20), date(2026, 10, 5))
    return_to_supplier(gl, s, D(2), date(2026, 10, 6))
    check("return 2: GRNI 8,100.00", gl.balance("GRNI") == D("-8100.00"))
    try:
        return_to_supplier(gl, s, D(19), date(2026, 10, 6))
        check("return beyond received-not-billed rejected", False)
    except BusinessRule as e:
        check("return beyond received-not-billed rejected", True, str(e))
    match_invoice(gl, s, D(18), D("450"), D(1), D(5), date(2026, 10, 9))
    check("invoice 18 clears GRNI", gl.balance("GRNI") == 0)
    check("CLOSED_FOR_INVOICING (18 of 20 received)", s.closure() == "CLOSED_FOR_INVOICING", s.closure())
    cancel_remaining(s)
    check("cancel remaining 2 -> CLOSED", s.closure() == "CLOSED" and s.cancelled == 2, s.closure())
    check("all journals balanced", all(j.balanced() for j in gl.journals))


def example_e():
    print("E. Stationery - period-end accrual")
    gl = Ledger()
    s = Schedule("QUANTITY", D("5"), "AED", D(1), "THREE_WAY", False,
                 [dist(100, "6103001-STATIONERY", accrual="ACCRUED_LIAB")])
    receive(gl, s, D(100), date(2026, 9, 28))
    check("receipt creates no journal (accrue at receipt = N)", len(gl.journals) == 0)
    amt = period_end_accrual(gl, [s], date(2026, 9, 30), date(2026, 10, 1))
    check("30 Sep accrual 500.00", amt == D("500.00"))
    check("Sep expense 500.00 via accrual", gl.balance("6103001-STATIONERY", date(2026, 9, 30)) == D("500.00"))
    match_invoice(gl, s, D(100), D("5"), D(1), D(5), date(2026, 10, 5))
    check("accrued liabilities back to 0.00 after reversal", gl.balance("ACCRUED_LIAB") == 0)
    check("Oct expense net 0.00 (reversal -500 + invoice +500)",
          gl.balance("6103001-STATIONERY") - gl.balance("6103001-STATIONERY", date(2026, 9, 30)) == 0)
    check("second run on 31 Oct accrues nothing (fully billed)",
          period_end_accrual(gl, [s], date(2026, 10, 31), date(2026, 11, 1)) == 0)
    check("all journals balanced", all(j.balanced() for j in gl.journals))


if __name__ == "__main__":
    for ex in (example_a, example_a_holds, example_b, example_c, example_d, example_e):
        results.clear()
        ex()
        print("\n".join(results))
    print("\nAll scenarios passed.")
