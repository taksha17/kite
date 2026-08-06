import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import type { LedgerBalanceInput } from "../lib/accounting/reports";
import {
  buildFollowUpTargets,
  draftPaymentReminder,
  mailtoHref,
  whatsappHref,
  type FollowUpTarget,
  type ReminderDraft,
} from "../lib/ar/followUp";
import {
  fetchLedgerBalances,
  listLedgers,
} from "../lib/db/client";
import {
  fetchOpenSalesInvoices,
  oldestOpenByParty,
} from "../lib/ar/openInvoices";
import { useApp } from "../state/AppContext";

export function FollowUpPage() {
  const { company } = useApp();
  const [targets, setTargets] = useState<FollowUpTarget[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ReminderDraft | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!company) return;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const [balances, ledgers, opens] = await Promise.all([
          fetchLedgerBalances(),
          listLedgers(),
          fetchOpenSalesInvoices(),
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
        const list = buildFollowUpTargets(
          mapped,
          ledgers,
          oldestOpenByParty(opens),
          today,
        );
        setTargets(list);
        if (list[0]) setSelectedId(list[0].ledgerId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [company]);

  const selected = useMemo(
    () => targets.find((t) => t.ledgerId === selectedId) || null,
    [targets, selectedId],
  );

  useEffect(() => {
    if (!company || !selected) {
      setDraft(null);
      return;
    }
    setDraft(
      draftPaymentReminder({
        companyName: company.name,
        partyName: selected.name,
        amount: selected.amount,
        daysOverdue: selected.daysOverdue,
        oldestOpenNumber: selected.oldestOpenNumber,
      }),
    );
    setCopied(false);
  }, [company, selected]);

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  async function copyBody() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.body);
      setCopied(true);
    } catch {
      setError("Could not copy — select the text manually.");
    }
  }

  const total = targets.reduce((s, t) => s + t.amount, 0);
  const wa =
    selected?.phone && draft ? whatsappHref(selected.phone, draft) : null;
  const mail =
    selected?.email && draft ? mailtoHref(selected.email, draft) : null;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Receivables follow-up</h1>
          <p className="lede">
            Draft payment reminders for customers with open balances. You always
            review and send — Kite never sends on its own.
          </p>
        </div>
        <Link className="ghost btn" to="/">
          Home
        </Link>
      </header>

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">Loading open balances…</p>}

      {!loading && targets.length === 0 && (
        <section className="panel" style={{ maxWidth: 560 }}>
          <p className="muted">
            No open customer balances right now. Post a sales voucher (and leave
            it unpaid) to see follow-ups here.
          </p>
        </section>
      )}

      {targets.length > 0 && (
        <div className="grid-2" style={{ gap: "1rem", alignItems: "start" }}>
          <section className="panel">
            <div className="row-between" style={{ marginBottom: "0.6rem" }}>
              <h2 style={{ margin: 0 }}>Open receivables</h2>
              <span className="muted small">{formatInr(total)} total</span>
            </div>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="num">Balance</th>
                    <th>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr
                      key={t.ledgerId}
                      className={
                        t.ledgerId === selectedId ? "row-selected" : undefined
                      }
                      style={{ cursor: "pointer" }}
                      onClick={() => setSelectedId(t.ledgerId)}
                    >
                      <td>
                        <div>{t.name}</div>
                        <div className="muted small">
                          {[t.email, t.phone].filter(Boolean).join(" · ") ||
                            "No email/phone on ledger"}
                        </div>
                      </td>
                      <td className="num">{formatInr(t.amount)}</td>
                      <td className="muted small">
                        {t.daysOverdue != null
                          ? `${t.daysOverdue}d overdue${t.oldestOpenNumber ? ` · ${t.oldestOpenNumber}` : ""}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <h2 style={{ marginTop: 0 }}>
              Reminder{selected ? ` — ${selected.name}` : ""}
            </h2>
            {!selected || !draft ? (
              <p className="muted">Select a customer.</p>
            ) : (
              <>
                <label>
                  Subject
                  <input value={draft.subject} readOnly />
                </label>
                <label style={{ marginTop: "0.6rem", display: "block" }}>
                  Message
                  <textarea
                    rows={10}
                    value={draft.body}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        body: e.target.value,
                        whatsappText: e.target.value,
                      })
                    }
                  />
                </label>
                <p className="muted small" style={{ marginTop: "0.5rem" }}>
                  Edit freely before sending. Amounts came from your books.
                </p>
                <div className="cta-row wrap" style={{ marginTop: "0.75rem" }}>
                  <button
                    type="button"
                    className="ghost btn"
                    onClick={() => void copyBody()}
                  >
                    {copied ? "Copied" : "Copy text"}
                  </button>
                  {mail ? (
                    <a className="secondary btn" href={mail}>
                      Open email
                    </a>
                  ) : (
                    <span className="muted small">
                      Add email on the party ledger to open mail
                    </span>
                  )}
                  {wa ? (
                    <a
                      className="primary btn"
                      href={wa}
                      target="_blank"
                      rel="noreferrer"
                    >
                      WhatsApp
                    </a>
                  ) : (
                    <span className="muted small">
                      Add mobile on the party ledger for WhatsApp
                    </span>
                  )}
                  <Link
                    className="ghost btn"
                    to={`/ledgers`}
                    title="Edit party contacts"
                  >
                    Edit contacts
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
