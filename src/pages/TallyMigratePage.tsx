import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { applyLedgerImport, applyStockImport } from "../lib/dataimport/apply";
import { recountStatuses } from "../lib/dataimport/prepare";
import type {
  ImportSummary,
  PreparedLedgerRow,
  PreparedStockRow,
} from "../lib/dataimport/types";
import { listGroups, listLedgers } from "../lib/db/client";
import type { AccountGroupRow } from "../lib/db/types";
import { listStockItems } from "../lib/db/inventory";
import { isTauriRuntime } from "../lib/server/remote";
import {
  defaultTallyUrl,
  probeTally,
  pullLedgers,
  pullStockItems,
} from "../lib/tally/client";
import { prepareTallyLedgers, prepareTallyStock } from "../lib/tally/prepare";
import type { TallyPullKind } from "../lib/tally/types";
import { useApp } from "../state/AppContext";

type Step = "connect" | "review" | "done";

export function TallyMigratePage() {
  const { company, allowed } = useApp();
  const desktop = isTauriRuntime();

  const [step, setStep] = useState<Step>("connect");
  const [url, setUrl] = useState(defaultTallyUrl());
  const [companyName, setCompanyName] = useState("");
  const [kind, setKind] = useState<TallyPullKind>("ledgers");
  const [groups, setGroups] = useState<AccountGroupRow[]>([]);
  const [ledgerRows, setLedgerRows] = useState<PreparedLedgerRow[]>([]);
  const [stockRows, setStockRows] = useState<PreparedStockRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!company) return;
    void listGroups().then(setGroups);
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
  if (!allowed("manage_ledgers")) {
    return (
      <div className="page">
        <p className="muted">You need ledger permission to migrate from Tally.</p>
      </div>
    );
  }

  async function onProbe() {
    setError(null);
    setBusy(true);
    setConnected(false);
    try {
      const info = await probeTally(url);
      setUrl(info.baseUrl);
      setCompanyName(info.name);
      setConnected(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPull() {
    setError(null);
    setBusy(true);
    try {
      const baseUrl = url;
      if (kind === "stock") {
        if (!allowed("manage_inventory")) {
          throw new Error("You need inventory permission to pull stock.");
        }
        const items = await pullStockItems({ baseUrl });
        const existing = new Set(
          (await listStockItems()).map((i) => i.name.toLowerCase()),
        );
        setStockRows(prepareTallyStock(items, existing));
        setLedgerRows([]);
      } else {
        const ledgers = await pullLedgers({ baseUrl });
        const existing = new Set(
          (await listLedgers()).map((l) => l.name.toLowerCase()),
        );
        setLedgerRows(prepareTallyLedgers(ledgers, groups, existing));
        setStockRows([]);
      }
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    setError(null);
    setBusy(true);
    try {
      const result =
        kind === "stock"
          ? await applyStockImport(stockRows)
          : await applyLedgerImport(ledgerRows);
      setSummary(result);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function patchLedger(idx: number, patch: Partial<PreparedLedgerRow>) {
    setLedgerRows((list) =>
      list.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        if (patch.groupId != null) {
          const g = groups.find((x) => x.id === patch.groupId);
          next.groupName = g?.name || next.groupName;
          next.status = "ready";
          next.reason = undefined;
        }
        return next;
      }),
    );
  }

  const counts =
    kind === "stock" ? recountStatuses(stockRows) : recountStatuses(ledgerRows);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Migrate from Tally</h1>
          <p className="lede">
            Keep TallyPrime open with a company loaded. Kite pulls masters over
            HTTP (port 9000) — you review, then create. No{" "}
            <code>.900</code> files.
          </p>
        </div>
        <div className="cta-row">
          <Link className="ghost btn" to="/data-import">
            Excel import
          </Link>
          <Link className="ghost btn" to="/ledgers">
            Ledgers
          </Link>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!desktop && (
        <p className="warn-text" role="status">
          Live Tally pull needs <strong>Kite Solo</strong> (desktop) on the same
          PC as TallyPrime. In the browser / Enterprise remote UI, use{" "}
          <Link to="/data-import">Excel/CSV import</Link> instead.
        </p>
      )}

      {step === "connect" && (
        <section className="panel">
          <h2>1. Connect</h2>
          <ol className="muted small" style={{ margin: "0.5rem 0 1rem", paddingLeft: "1.25rem" }}>
            <li>Open TallyPrime and load the company to migrate.</li>
            <li>
              Enable the HTTP server: Help → Settings → Connectivity (port{" "}
              <strong>9000</strong>).
            </li>
            <li>Leave Tally running, then probe from Kite.</li>
          </ol>

          <div className="form-row">
            <label style={{ flex: 1 }}>
              Tally URL
              <input
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setConnected(false);
                }}
                placeholder="http://127.0.0.1:9000"
                disabled={busy || !desktop}
              />
            </label>
          </div>

          <div className="cta-row" style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="primary btn"
              disabled={busy || !desktop}
              onClick={() => void onProbe()}
            >
              {busy ? "Probing…" : "Probe Tally"}
            </button>
          </div>

          {connected && (
            <div style={{ marginTop: "1.25rem" }}>
              <p className="ok-text">
                Connected{companyName ? ` — ${companyName}` : ""}.
              </p>
              <div className="form-row" style={{ marginTop: "0.75rem" }}>
                <label>
                  Pull
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as TallyPullKind)}
                    disabled={busy}
                  >
                    <option value="ledgers">Ledgers &amp; parties (openings)</option>
                    <option value="stock">Stock items</option>
                  </select>
                </label>
              </div>
              <div className="cta-row" style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="primary btn"
                  disabled={busy}
                  onClick={() => void onPull()}
                >
                  {busy ? "Pulling…" : "Pull & review"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {step === "review" && (
        <section className="panel">
          <h2>2. Review</h2>
          <p className="muted small">
            From Tally{companyName ? ` (${companyName})` : ""} · Ready:{" "}
            {counts.ready} · Skip: {counts.skip} · Need fix: {counts.error}
          </p>

          {kind === "ledgers" ? (
            <div
              className="table-wrap"
              style={{ marginTop: "0.75rem", overflowX: "auto" }}
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Tally parent → Kite group</th>
                    <th>Opening Dr</th>
                    <th>Opening Cr</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((row, idx) => (
                    <tr key={`${row.name}-${idx}`}>
                      <td>
                        {row.name}
                        {row.isParty && (
                          <span className="muted small"> · party</span>
                        )}
                      </td>
                      <td>
                        <div className="muted small">{row.groupName || "—"}</div>
                        <select
                          value={row.groupId ?? ""}
                          onChange={(e) =>
                            patchLedger(idx, {
                              groupId: Number(e.target.value) || null,
                            })
                          }
                        >
                          <option value="">— pick group —</option>
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{formatInr(row.openingDebit)}</td>
                      <td>{formatInr(row.openingCredit)}</td>
                      <td>
                        {row.status === "ready" && (
                          <span className="ok-text">ready</span>
                        )}
                        {row.status === "skip" && (
                          <span className="muted">{row.reason}</span>
                        )}
                        {row.status === "error" && (
                          <span className="warn-text">{row.reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              className="table-wrap"
              style={{ marginTop: "0.75rem", overflowX: "auto" }}
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Unit</th>
                    <th>HSN</th>
                    <th>GST %</th>
                    <th>Op qty</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stockRows.map((row, idx) => (
                    <tr key={`${row.name}-${idx}`}>
                      <td>{row.name}</td>
                      <td>{row.unitLabel}</td>
                      <td>{row.hsn || "—"}</td>
                      <td>{row.gstRate}</td>
                      <td>{row.openingQty}</td>
                      <td>
                        {row.status === "ready" && (
                          <span className="ok-text">ready</span>
                        )}
                        {row.status === "skip" && (
                          <span className="muted">{row.reason}</span>
                        )}
                        {row.status === "error" && (
                          <span className="warn-text">{row.reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="cta-row" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="ghost btn"
              disabled={busy}
              onClick={() => setStep("connect")}
            >
              Back
            </button>
            <button
              type="button"
              className="primary btn"
              disabled={busy || counts.ready === 0}
              onClick={() => void onImport()}
            >
              {busy
                ? "Importing…"
                : `Create ${counts.ready} ready ${kind === "stock" ? "item" : "ledger"}${counts.ready === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      )}

      {step === "done" && summary && (
        <section className="panel">
          <h2>Done</h2>
          <p>
            Created <strong>{summary.created}</strong>, skipped{" "}
            <strong>{summary.skipped}</strong>, failed{" "}
            <strong>{summary.failed}</strong>.
          </p>
          {summary.errors.length > 0 && (
            <ul className="muted small">
              {summary.errors.slice(0, 12).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="cta-row" style={{ marginTop: "1rem" }}>
            <button
              type="button"
              className="primary btn"
              onClick={() => {
                setStep("connect");
                setSummary(null);
                setConnected(true);
                setLedgerRows([]);
                setStockRows([]);
              }}
            >
              Pull again
            </button>
            <Link className="ghost btn" to={kind === "stock" ? "/inventory" : "/ledgers"}>
              View {kind === "stock" ? "inventory" : "ledgers"}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
