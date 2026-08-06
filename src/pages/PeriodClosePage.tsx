import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  buildPeriodCloseChecklist,
  monthLabelFromIso,
  type PeriodCloseItem,
} from "../lib/accounting/periodClose";
import { monthBounds } from "../lib/accounting/homeInsights";
import type { LedgerBalanceInput } from "../lib/accounting/reports";
import {
  fetchGstInvoices,
  fetchLedgerBalances,
} from "../lib/db/client";
import { useApp } from "../state/AppContext";

export function PeriodClosePage() {
  const { company } = useApp();
  const [items, setItems] = useState<PeriodCloseItem[]>([]);
  const [monthLabel, setMonthLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!company) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const bounds = monthBounds(today);
        const label = monthLabelFromIso(today);
        setMonthLabel(label);

        const [balances, gstAll] = await Promise.all([
          fetchLedgerBalances(),
          fetchGstInvoices("all"),
        ]);
        const mapped: LedgerBalanceInput[] = balances.map((b) => ({
          ledgerId: b.ledger_id,
          ledgerName: b.ledger_name,
          groupName: b.group_name,
          nature: b.nature as LedgerBalanceInput["nature"],
          openingDebit: b.opening_debit,
          openingCredit: b.opening_credit,
          periodDebit: b.period_debit,
          periodCredit: b.period_credit,
        }));

        const gstMonth = gstAll.filter(
          (r) => r.date >= bounds.thisStart && r.date < bounds.nextStart,
        );
        const salesMissingHsn = gstMonth.filter(
          (r) =>
            r.voucher_type === "sales" &&
            !(r.hsn_sac && String(r.hsn_sac).trim()),
        ).length;
        const purchasesMissingHsn = gstMonth.filter(
          (r) =>
            r.voucher_type === "purchase" &&
            !(r.hsn_sac && String(r.hsn_sac).trim()),
        ).length;

        const gstSalesMissingPartyGstin = gstMonth.filter(
          (r) =>
            r.voucher_type === "sales" &&
            !(r.party_gstin && String(r.party_gstin).trim()),
        ).length;

        const bankLedgerCount = mapped.filter(
          (b) => b.groupName === "Bank Accounts",
        ).length;

        setItems(
          buildPeriodCloseChecklist({
            companyName: company.name,
            monthLabel: label,
            gstEnabled: Boolean(company.gst_enabled),
            balances: mapped,
            gstRowsThisMonth: gstMonth,
            salesMissingHsn,
            purchasesMissingHsn,
            gstSalesMissingPartyGstin,
            bankLedgerCount,
          }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [company]);

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  function toggle(id: string) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const remaining = items.filter((i) => !done.has(i.id)).length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Period close</h1>
          <p className="lede">
            Month-end checklist for {monthLabel || "this month"} — tick items as
            you finish. Figures come from your books.
          </p>
        </div>
        <Link className="ghost btn" to="/">
          Home
        </Link>
      </header>

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">Building checklist…</p>}

      {!loading && items.length > 0 && (
        <section className="panel" style={{ maxWidth: 720 }}>
          <p className="muted small" style={{ marginTop: 0 }}>
            {remaining === 0
              ? "All items checked — nice close."
              : `${remaining} item${remaining === 1 ? "" : "s"} still open`}
          </p>
          <ul className="checklist">
            {items.map((item) => {
              const checked = done.has(item.id);
              return (
                <li
                  key={item.id}
                  className={`checklist-item status-${item.status}${checked ? " checked" : ""}`}
                >
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(item.id)}
                    />
                    <span>
                      <strong>{item.title}</strong>
                      <span className="muted small" style={{ display: "block" }}>
                        {item.detail}
                      </span>
                    </span>
                  </label>
                  <Link className="ghost btn" to={item.href}>
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
