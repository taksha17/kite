import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import {
  buildHomeInsightCards,
  computeLowStock,
  computePartyBalances,
  monthBounds,
  type HomeInsightCard,
} from "../lib/accounting/homeInsights";
import { summarizeGstr3b } from "../lib/accounting/gstReports";
import {
  computeProfitAndLoss,
  type LedgerBalanceInput,
} from "../lib/accounting/reports";
import { AiOnboardingWizard } from "../components/AiOnboardingWizard";
import {
  fetchGstInvoices,
  fetchLedgerBalances,
  fetchSalesInsightTotals,
  listVouchers,
} from "../lib/db/client";
import { fetchStockSummary } from "../lib/db/inventory";
import {
  fetchOpenSalesInvoices,
  sumOpenOlderThan,
} from "../lib/ar/openInvoices";
import { useApp } from "../state/AppContext";

export function HomePage() {
  const { company, ready } = useApp();
  const [params, setParams] = useSearchParams();
  const [voucherCount, setVoucherCount] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [cashBank, setCashBank] = useState(0);
  const [insights, setInsights] = useState<HomeInsightCard[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const [setupDesc, setSetupDesc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (params.get("setup") !== "1") return;
    const desc = params.get("desc") || undefined;
    setSetupDesc(desc || undefined);
    setWizardOpen(true);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("setup");
        next.delete("desc");
        return next;
      },
      { replace: true },
    );
  }, [params, setParams]);

  useEffect(() => {
    if (!company) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const bounds = monthBounds(today);

      const [vouchers, balances, sales, gstRows, stockRows, openInvoices] =
        await Promise.all([
          listVouchers(500),
          fetchLedgerBalances(),
          fetchSalesInsightTotals(bounds),
          fetchGstInvoices("all").catch(() => []),
          fetchStockSummary().catch(() => []),
          fetchOpenSalesInvoices().catch(() => []),
        ]);

      setVoucherCount(vouchers.length);
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
      setNetProfit(computeProfitAndLoss(mapped).netProfit);
      const cash = mapped
        .filter(
          (r) =>
            r.groupName === "Cash-in-Hand" || r.groupName === "Bank Accounts",
        )
        .reduce(
          (sum, r) =>
            sum +
            (r.openingDebit +
              r.periodDebit -
              (r.openingCredit + r.periodCredit)),
          0,
        );
      setCashBank(Math.round(cash * 100) / 100);

      const party = computePartyBalances(mapped);
      const gstMonth = gstRows.filter(
        (r) => r.date >= bounds.thisStart && r.date < bounds.nextStart,
      );
      const g3 = summarizeGstr3b(gstMonth);
      const gstNet = Math.round((g3.netCgst + g3.netSgst + g3.netIgst) * 100) / 100;
      const stock = computeLowStock(stockRows);

      setInsights(
        buildHomeInsightCards({
          today,
          party,
          gstNetThisMonth: gstNet,
          salesThisMonth: sales.thisMonth,
          salesLastMonth: sales.lastMonth,
          salesOlderThan30: sumOpenOlderThan(openInvoices, bounds.agedBefore),
          stock,
          formatInr,
        }),
      );
    })();
  }, [company]);

  if (!ready) {
    return (
      <div className="page">
        <p className="muted">Starting Kite…</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="page hero-empty">
        <p className="eyebrow">Open source · India-first books</p>
        <h1>Keep your books light with Kite</h1>
        <p className="lede wide">
          A free MIT-licensed accounting app for Indian small businesses —
          double-entry, local files, and builds for Windows, macOS, and Linux.
        </p>
        <div className="cta-row">
          <Link className="primary btn" to="/companies">
            Create a company
          </Link>
          <a
            className="secondary btn"
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
          >
            Fork on Git
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>{company.name}</h1>
          <p className="lede">FY from {company.fy_start} · INR</p>
        </div>
        <div className="cta-row">
          <Link className="primary btn" to="/vouchers/new">
            New voucher
          </Link>
          <Link className="secondary btn" to="/ask">
            Ask
          </Link>
          <Link className="secondary btn" to="/reports">
            Reports
          </Link>
        </div>
      </header>

      <div className="stat-row">
        <div className="stat">
          <p className="muted small">Cash & bank</p>
          <p className="stat-value">{formatInr(cashBank)}</p>
        </div>
        <div className="stat">
          <p className="muted small">Net profit (books)</p>
          <p className="stat-value">{formatInr(netProfit)}</p>
        </div>
        <div className="stat">
          <p className="muted small">Vouchers</p>
          <p className="stat-value">{voucherCount}</p>
        </div>
      </div>

      {insights.length > 0 && (
        <section style={{ marginBottom: "1.25rem" }}>
          <div className="row-between" style={{ marginBottom: "0.55rem" }}>
            <h2 style={{ margin: 0, fontSize: "1.05rem" }}>Insights</h2>
            <span className="muted small">From your books · not AI guesses</span>
          </div>
          <div className="insight-row">
            {insights.map((card) => (
              <Link
                key={card.id}
                to={card.href}
                className={`stat insight tone-${card.tone}`}
              >
                <p className="muted small">{card.label}</p>
                <p className="stat-value">{card.value}</p>
                <p className="muted small" style={{ marginTop: "0.35rem" }}>
                  {card.detail}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {voucherCount === 0 && !wizardDismissed && !wizardOpen && (
        <section className="panel" style={{ maxWidth: 760 }}>
          <div className="panel-head">
            <h2 style={{ margin: 0 }}>New books? Let AI set them up</h2>
            <button
              type="button"
              className="ghost btn"
              onClick={() => setWizardDismissed(true)}
            >
              Skip
            </button>
          </div>
          <p className="muted small">
            Describe your business in one sentence — the AI proposes your
            starting ledgers, stock items and GST setting. You review before
            anything is created.
          </p>
          <button
            type="button"
            className="primary btn"
            onClick={() => setWizardOpen(true)}
          >
            Set up with AI
          </button>
        </section>
      )}

      {wizardOpen && (
        <AiOnboardingWizard
          initialDescription={setupDesc}
          onClose={() => {
            setWizardOpen(false);
            setSetupDesc(undefined);
          }}
        />
      )}

      <section className="panel">
        <h2>Quick actions</h2>
        <div className="cta-row wrap">
          <Link className="secondary btn" to="/ledgers">
            Ledgers & parties
          </Link>
          <Link className="secondary btn" to="/inventory">
            Inventory
          </Link>
          <Link className="secondary btn" to="/integrations">
            Integrations
          </Link>
          <Link className="secondary btn" to="/vouchers/new?type=sales">
            Sales voucher
          </Link>
          <Link className="secondary btn" to="/vouchers/new?type=payment">
            Payment
          </Link>
          <Link className="secondary btn" to="/vouchers/new?type=receipt">
            Receipt
          </Link>
          <Link className="secondary btn" to="/anomalies">
            Anomalies
          </Link>
          <Link className="secondary btn" to="/period-close">
            Period close
          </Link>
          <Link className="secondary btn" to="/follow-up">
            Follow-up
          </Link>
          <Link className="secondary btn" to="/ask">
            Ask my books
          </Link>
          <Link className="secondary btn" to="/reports">
            Trial balance
          </Link>
        </div>
      </section>
    </div>
  );
}
