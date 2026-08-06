import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { AiOnboardingWizard } from "../components/AiOnboardingWizard";
import {
  computeProfitAndLoss,
  type LedgerBalanceInput,
} from "../lib/accounting/reports";
import { fetchLedgerBalances, listVouchers } from "../lib/db/client";
import { useApp } from "../state/AppContext";

export function HomePage() {
  const { company, ready } = useApp();
  const [voucherCount, setVoucherCount] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [cashBank, setCashBank] = useState(0);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(false);

  useEffect(() => {
    if (!company) return;
    (async () => {
      const vouchers = await listVouchers(500);
      setVoucherCount(vouchers.length);
      const balances = await fetchLedgerBalances();
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
        <AiOnboardingWizard onClose={() => setWizardOpen(false)} />
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
