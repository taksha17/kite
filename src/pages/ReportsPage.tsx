import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import {
  exportGstr1Excel,
  exportGstr3bExcel,
} from "../lib/accounting/gstExcel";
import { summarizeGstr1, summarizeGstr3b } from "../lib/accounting/gstReports";
import {
  computeBalanceSheet,
  computeProfitAndLoss,
  computeTrialBalance,
  type LedgerBalanceInput,
} from "../lib/accounting/reports";
import {
  fetchDayBook,
  fetchGstInvoices,
  fetchLedgerBalances,
  fetchLedgerStatement,
  listLedgers,
  type GstInvoiceRow,
  type LedgerRow,
} from "../lib/db/client";
import {
  fetchStockSummary,
  type StockSummaryRow,
} from "../lib/db/inventory";
import { useApp } from "../state/AppContext";

type ReportTab =
  | "trial"
  | "pnl"
  | "bs"
  | "daybook"
  | "ledger"
  | "gstr1"
  | "gstr3b"
  | "stock";

export function ReportsPage() {
  const { company } = useApp();
  const [tab, setTab] = useState<ReportTab>("trial");
  const [balances, setBalances] = useState<LedgerBalanceInput[]>([]);
  const [daybook, setDaybook] = useState<
    Awaited<ReturnType<typeof fetchDayBook>>
  >([]);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [gstRows, setGstRows] = useState<GstInvoiceRow[]>([]);
  const [stockRows, setStockRows] = useState<StockSummaryRow[]>([]);
  const [ledgerId, setLedgerId] = useState<number | "">("");
  const [ledgerStmt, setLedgerStmt] = useState<Awaited<
    ReturnType<typeof fetchLedgerStatement>
  > | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  useEffect(() => {
    if (!company) return;
    (async () => {
      const rows = await fetchLedgerBalances();
      setBalances(
        rows.map((b) => ({
          ledgerId: b.ledger_id,
          ledgerName: b.ledger_name,
          groupName: b.group_name,
          nature: b.nature as LedgerBalanceInput["nature"],
          openingDebit: b.opening_debit,
          openingCredit: b.opening_credit,
          periodDebit: b.period_debit,
          periodCredit: b.period_credit,
        })),
      );
      setDaybook(await fetchDayBook());
      setLedgers(await listLedgers());
      setGstRows(await fetchGstInvoices("all"));
      setStockRows(await fetchStockSummary());
    })();
  }, [company]);

  const trial = useMemo(() => computeTrialBalance(balances), [balances]);
  const pnl = useMemo(() => computeProfitAndLoss(balances), [balances]);
  const bs = useMemo(
    () => computeBalanceSheet(balances, pnl.netProfit),
    [balances, pnl.netProfit],
  );
  const gstr1 = useMemo(() => summarizeGstr1(gstRows), [gstRows]);
  const gstr3b = useMemo(() => summarizeGstr3b(gstRows), [gstRows]);

  useEffect(() => {
    if (!ledgerId) {
      setLedgerStmt(null);
      return;
    }
    void fetchLedgerStatement(Number(ledgerId)).then(setLedgerStmt);
  }, [ledgerId]);

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  const trialDr = trial.reduce((s, r) => s + r.debit, 0);
  const trialCr = trial.reduce((s, r) => s + r.credit, 0);

  const tabs: [ReportTab, string][] = [
    ["trial", "Trial balance"],
    ["pnl", "Profit & loss"],
    ["bs", "Balance sheet"],
    ["daybook", "Day book"],
    ["ledger", "Ledger"],
    ["gstr1", "GSTR-1"],
    ["gstr3b", "GSTR-3B"],
    ["stock", "Stock summary"],
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Reports</h1>
          <p className="lede">
            Read-only views over your local books. GST tabs summarize taxable
            invoices — not portal filing.
          </p>
        </div>
      </header>

      {exportNotice && <p className="notice">{exportNotice}</p>}
      {exportError && <p className="error">{exportError}</p>}

      <div className="tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "tab active" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "trial" && (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Ledger</th>
                <th>Group</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {trial.map((r) => (
                <tr key={r.ledgerId}>
                  <td>{r.ledgerName}</td>
                  <td>{r.groupName}</td>
                  <td className="num">{r.debit ? formatInr(r.debit) : ""}</td>
                  <td className="num">{r.credit ? formatInr(r.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>{formatInr(trialDr)}</strong>
                </td>
                <td className="num">
                  <strong>{formatInr(trialCr)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}

      {tab === "pnl" && (
        <section className="grid-2">
          <div className="panel">
            <h2>Income</h2>
            <ul className="list">
              {pnl.income.map((l) => (
                <li key={l.name} className="list-row">
                  <span>{l.name}</span>
                  <span>{formatInr(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h2>Expenses</h2>
            <ul className="list">
              {pnl.expenses.map((l) => (
                <li key={l.name} className="list-row">
                  <span>{l.name}</span>
                  <span>{formatInr(l.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="stat-value" style={{ marginTop: "1rem" }}>
              Net {pnl.netProfit >= 0 ? "profit" : "loss"}:{" "}
              {formatInr(Math.abs(pnl.netProfit))}
            </p>
          </div>
        </section>
      )}

      {tab === "bs" && (
        <section className="grid-2">
          <div className="panel">
            <h2>Assets</h2>
            <ul className="list">
              {bs.assets.map((l) => (
                <li key={l.name} className="list-row">
                  <span>{l.name}</span>
                  <span>{formatInr(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <h2>Liabilities & equity</h2>
            <ul className="list">
              {[...bs.liabilities, ...bs.equity].map((l) => (
                <li key={l.name} className="list-row">
                  <span>{l.name}</span>
                  <span>{formatInr(l.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {tab === "daybook" && (
        <section className="panel">
          {daybook.map((v) => (
            <div key={v.id} className="daybook-item">
              <div className="list-row">
                <strong>
                  {v.date} · {v.voucher_type}
                  {v.number ? ` #${v.number}` : ""}
                </strong>
                <span>{formatInr(v.total_amount)}</span>
              </div>
              {v.narration && <p className="muted small">{v.narration}</p>}
              <ul className="mini-lines">
                {v.lines.map((l) => (
                  <li key={l.id}>
                    {l.ledger_name}:{" "}
                    {l.debit
                      ? `Dr ${formatInr(l.debit)}`
                      : `Cr ${formatInr(l.credit)}`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {tab === "ledger" && (
        <section className="panel">
          <label>
            Choose ledger
            <select
              value={ledgerId}
              onChange={(e) =>
                setLedgerId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">Select…</option>
              {ledgers.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          {ledgerStmt && (
            <table className="table" style={{ marginTop: "1rem" }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Narration</th>
                  <th className="num">Debit</th>
                  <th className="num">Credit</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={3}>Opening</td>
                  <td className="num">
                    {ledgerStmt.ledger.opening_debit
                      ? formatInr(ledgerStmt.ledger.opening_debit)
                      : ""}
                  </td>
                  <td className="num">
                    {ledgerStmt.ledger.opening_credit
                      ? formatInr(ledgerStmt.ledger.opening_credit)
                      : ""}
                  </td>
                </tr>
                {ledgerStmt.lines.map((l, i) => (
                  <tr key={`${l.voucher_id}-${i}`}>
                    <td>{l.date}</td>
                    <td>{l.voucher_type}</td>
                    <td>{l.narration || "—"}</td>
                    <td className="num">
                      {l.debit ? formatInr(l.debit) : ""}
                    </td>
                    <td className="num">
                      {l.credit ? formatInr(l.credit) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "gstr1" && (
        <section className="panel">
          <div className="panel-head">
            <h2 style={{ margin: 0 }}>GSTR-1 (sales)</h2>
            <button
              type="button"
              className="secondary"
              disabled={exportBusy || gstr1.invoices.length === 0}
              onClick={() => {
                void (async () => {
                  setExportBusy(true);
                  setExportError(null);
                  setExportNotice(null);
                  try {
                    const path = await exportGstr1Excel(gstr1, company.name);
                    if (path) setExportNotice(`Excel saved to ${path}`);
                  } catch (e) {
                    setExportError(
                      e instanceof Error ? e.message : String(e),
                    );
                  } finally {
                    setExportBusy(false);
                  }
                })();
              }}
            >
              {exportBusy ? "Exporting…" : "Download Excel"}
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            Excel includes Summary, B2B, B2C, and All invoices sheets — for
            books and accountant review, not official portal JSON upload.
          </p>
          <div className="stat-row">
            <div className="stat">
              <p className="muted small">Taxable (outward)</p>
              <p className="stat-value">{formatInr(gstr1.taxableValue)}</p>
            </div>
            <div className="stat">
              <p className="muted small">Tax</p>
              <p className="stat-value" style={{ fontSize: "1.15rem" }}>
                CGST {formatInr(gstr1.cgst)} · SGST {formatInr(gstr1.sgst)} ·
                IGST {formatInr(gstr1.igst)}
              </p>
            </div>
            <div className="stat">
              <p className="muted small">B2B / B2C invoices</p>
              <p className="stat-value">
                {gstr1.b2bCount} / {gstr1.b2cCount}
              </p>
            </div>
          </div>
          {gstr1.invoices.length === 0 ? (
            <p className="muted">
              No taxable sales yet. Enable GST and post a Sales voucher.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Party</th>
                  <th>POS</th>
                  <th>HSN</th>
                  <th className="num">Taxable</th>
                  <th className="num">CGST</th>
                  <th className="num">SGST</th>
                  <th className="num">IGST</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {gstr1.invoices.map((r) => (
                  <tr key={r.id}>
                    <td>{r.date}</td>
                    <td>
                      {r.party_name || "—"}
                      {r.party_gstin ? (
                        <div className="muted small">{r.party_gstin}</div>
                      ) : null}
                    </td>
                    <td>{r.place_of_supply || "—"}</td>
                    <td>{r.hsn_sac || "—"}</td>
                    <td className="num">{formatInr(r.taxable_value)}</td>
                    <td className="num">{formatInr(r.cgst_amount)}</td>
                    <td className="num">{formatInr(r.sgst_amount)}</td>
                    <td className="num">{formatInr(r.igst_amount)}</td>
                    <td className="num">{formatInr(r.total_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {tab === "gstr3b" && (
        <>
          <div className="panel-head" style={{ marginBottom: "0.75rem" }}>
            <p className="muted small" style={{ margin: 0 }}>
              Excel includes 3B Summary plus outward/inward detail sheets.
            </p>
            <button
              type="button"
              className="secondary"
              disabled={exportBusy}
              onClick={() => {
                void (async () => {
                  setExportBusy(true);
                  setExportError(null);
                  setExportNotice(null);
                  try {
                    const path = await exportGstr3bExcel(
                      gstr3b,
                      company.name,
                      gstRows,
                    );
                    if (path) setExportNotice(`Excel saved to ${path}`);
                  } catch (e) {
                    setExportError(
                      e instanceof Error ? e.message : String(e),
                    );
                  } finally {
                    setExportBusy(false);
                  }
                })();
              }}
            >
              {exportBusy ? "Exporting…" : "Download Excel"}
            </button>
          </div>
        <section className="grid-2">
          <div className="panel">
            <h2>3.1 Outward supplies</h2>
            <ul className="list">
              <li className="list-row">
                <span>Taxable value</span>
                <span>{formatInr(gstr3b.outwardTaxable)}</span>
              </li>
              <li className="list-row">
                <span>CGST</span>
                <span>{formatInr(gstr3b.outwardCgst)}</span>
              </li>
              <li className="list-row">
                <span>SGST</span>
                <span>{formatInr(gstr3b.outwardSgst)}</span>
              </li>
              <li className="list-row">
                <span>IGST</span>
                <span>{formatInr(gstr3b.outwardIgst)}</span>
              </li>
            </ul>
          </div>
          <div className="panel">
            <h2>4. Eligible ITC (from purchases)</h2>
            <ul className="list">
              <li className="list-row">
                <span>Inward taxable</span>
                <span>{formatInr(gstr3b.inwardTaxable)}</span>
              </li>
              <li className="list-row">
                <span>ITC CGST</span>
                <span>{formatInr(gstr3b.itcCgst)}</span>
              </li>
              <li className="list-row">
                <span>ITC SGST</span>
                <span>{formatInr(gstr3b.itcSgst)}</span>
              </li>
              <li className="list-row">
                <span>ITC IGST</span>
                <span>{formatInr(gstr3b.itcIgst)}</span>
              </li>
            </ul>
            <h2 style={{ marginTop: "1.2rem" }}>Net payable (approx.)</h2>
            <ul className="list">
              <li className="list-row">
                <span>CGST</span>
                <span>{formatInr(gstr3b.netCgst)}</span>
              </li>
              <li className="list-row">
                <span>SGST</span>
                <span>{formatInr(gstr3b.netSgst)}</span>
              </li>
              <li className="list-row">
                <span>IGST</span>
                <span>{formatInr(gstr3b.netIgst)}</span>
              </li>
            </ul>
          </div>
        </section>
        </>
      )}

      {tab === "stock" && (
        <section className="panel">
          <p className="muted small">
            Quantity on hand by godown. Value = qty × fixed purchase rate on the
            item.
          </p>
          {stockRows.length === 0 ? (
            <p className="muted">
              No stock balances. Add items under Inventory and post
              purchase/opening/journal.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Godown</th>
                  <th className="num">Qty</th>
                  <th className="num">Rate</th>
                  <th className="num">Value</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.map((r) => (
                  <tr key={`${r.item_id}-${r.godown_id}`}>
                    <td>
                      {r.item_name}{" "}
                      <span className="muted small">({r.unit_symbol})</span>
                    </td>
                    <td>{r.godown_name}</td>
                    <td className="num">{r.qty}</td>
                    <td className="num">{formatInr(r.purchase_rate)}</td>
                    <td className="num">{formatInr(r.value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    <strong>Total stock value</strong>
                  </td>
                  <td className="num">
                    <strong>
                      {formatInr(
                        stockRows.reduce((s, r) => s + r.value, 0),
                      )}
                    </strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
