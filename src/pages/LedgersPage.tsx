import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { INDIA_STATES } from "../lib/accounting/gst";
import {
  createLedger,
  createParty,
  listGroups,
  listLedgers,
  type AccountGroupRow,
  type LedgerRow,
} from "../lib/db/client";
import { useApp } from "../state/AppContext";

export function LedgersPage() {
  const { company, allowed } = useApp();
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [groups, setGroups] = useState<AccountGroupRow[]>([]);
  const [tab, setTab] = useState<"list" | "ledger" | "party">("list");
  const [error, setError] = useState<string | null>(null);

  const [ledgerName, setLedgerName] = useState("");
  const [groupId, setGroupId] = useState<number | "">("");
  const [opening, setOpening] = useState("0");

  const [partyName, setPartyName] = useState("");
  const [partyKind, setPartyKind] = useState<"debtor" | "creditor">("debtor");
  const [partyGstin, setPartyGstin] = useState("");
  const [partyEmail, setPartyEmail] = useState("");
  const [partyAddress, setPartyAddress] = useState("");
  const [partyState, setPartyState] = useState(company?.state_code || "29");

  async function refresh() {
    setLedgers(await listLedgers());
    setGroups(await listGroups());
  }

  useEffect(() => {
    if (company) {
      void refresh();
      if (company.state_code) setPartyState(company.state_code);
    }
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

  async function onCreateLedger(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const open = Number(opening) || 0;
      await createLedger({
        name: ledgerName,
        groupId: Number(groupId),
        openingDebit: open >= 0 ? open : 0,
        openingCredit: open < 0 ? Math.abs(open) : 0,
      });
      setLedgerName("");
      setOpening("0");
      setTab("list");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onCreateParty(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createParty({
        name: partyName,
        kind: partyKind,
        gstin: partyGstin || undefined,
        stateCode: partyState || undefined,
        email: partyEmail || undefined,
        address: partyAddress || undefined,
      });
      setPartyName("");
      setPartyGstin("");
      setPartyEmail("");
      setPartyAddress("");
      setTab("list");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Ledgers</h1>
          <p className="lede">Chart of accounts, cash, bank, and parties.</p>
        </div>
        <div className="cta-row">
          {allowed("manage_ledgers") && (
            <>
              <button type="button" className="secondary" onClick={() => setTab("party")}>
                Add party
              </button>
              <button type="button" className="primary" onClick={() => setTab("ledger")}>
                Add ledger
              </button>
            </>
          )}
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {tab === "list" && (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Group</th>
                <th>Opening</th>
                <th>GST / State</th>
              </tr>
            </thead>
            <tbody>
              {ledgers.map((l) => {
                const open = l.opening_debit - l.opening_credit;
                return (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>{l.group_name}</td>
                    <td className="num">{formatInr(open)}</td>
                    <td className="muted small">
                      {[
                        l.gstin || null,
                        l.state_code ? `State ${l.state_code}` : null,
                        l.is_party ? "Party" : null,
                        l.is_cash_bank ? "Cash/Bank" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {tab === "ledger" && (
        <section className="panel narrow">
          <h2>New ledger</h2>
          <form className="form" onSubmit={onCreateLedger}>
            <label>
              Name
              <input value={ledgerName} onChange={(e) => setLedgerName(e.target.value)} required />
            </label>
            <label>
              Under group
              <select
                value={groupId}
                onChange={(e) => setGroupId(Number(e.target.value))}
                required
              >
                <option value="">Select group</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Opening (positive = debit)
              <input
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                type="number"
                step="0.01"
              />
            </label>
            <div className="cta-row">
              <button className="primary" type="submit">
                Save ledger
              </button>
              <button className="ghost" type="button" onClick={() => setTab("list")}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {tab === "party" && (
        <section className="panel narrow">
          <h2>New party</h2>
          <form className="form" onSubmit={onCreateParty}>
            <label>
              Name
              <input value={partyName} onChange={(e) => setPartyName(e.target.value)} required />
            </label>
            <label>
              Type
              <select
                value={partyKind}
                onChange={(e) => setPartyKind(e.target.value as "debtor" | "creditor")}
              >
                <option value="debtor">Customer (Sundry Debtor)</option>
                <option value="creditor">Supplier (Sundry Creditor)</option>
              </select>
            </label>
            <label>
              State
              <select value={partyState} onChange={(e) => setPartyState(e.target.value)}>
                {INDIA_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              GSTIN (optional)
              <input
                value={partyGstin}
                onChange={(e) => setPartyGstin(e.target.value.toUpperCase())}
              />
            </label>
            <label>
              Address (Bill To on invoices)
              <textarea
                value={partyAddress}
                onChange={(e) => setPartyAddress(e.target.value)}
                rows={2}
                placeholder="Street, city, PIN"
              />
            </label>
            <label>
              Email (for invoicing)
              <input
                type="email"
                value={partyEmail}
                onChange={(e) => setPartyEmail(e.target.value)}
                placeholder="party@example.com"
              />
            </label>
            <div className="cta-row">
              <button className="primary" type="submit">
                Save party
              </button>
              <button className="ghost" type="button" onClick={() => setTab("list")}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
