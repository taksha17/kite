import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { listLedgers, type LedgerRow } from "../lib/db/client";
import {
  fetchImportedHashes,
  importRows,
  txnHash,
  type ImportRow,
  type ImportSummary,
} from "../lib/bankimport/import";
import {
  applyMapping,
  guessMapping,
  readStatementFile,
  type ColumnMapping,
  type SheetRows,
} from "../lib/bankimport/parse";
import {
  getBankRules,
  normalizeNarration,
  saveBankRule,
  suggestLedger,
} from "../lib/bankimport/rules";
import { useApp } from "../state/AppContext";

type Step = "upload" | "mapping" | "review" | "done";

function columnLabel(rows: SheetRows, headerRow: number, idx: number): string {
  const letters = String.fromCharCode(65 + (idx % 26));
  if (headerRow > 0) {
    const header = rows[headerRow - 1]?.[idx];
    if (header != null && String(header).trim()) {
      return `${letters} — ${String(header).trim().slice(0, 28)}`;
    }
  }
  return `Column ${letters}`;
}

export function BankImportPage() {
  const { company, allowed } = useApp();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [bankLedgerId, setBankLedgerId] = useState<number>(0);

  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<SheetRows>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [txnRows, setTxnRows] = useState<ImportRow[]>([]);
  const [suggestions, setSuggestions] = useState<Map<string, string>>(
    new Map(),
  );
  const [bulkLedgerId, setBulkLedgerId] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const bankLedgers = useMemo(
    () => ledgers.filter((l) => l.is_cash_bank),
    [ledgers],
  );
  const counterLedgers = useMemo(
    () => ledgers.filter((l) => !l.is_cash_bank),
    [ledgers],
  );

  useEffect(() => {
    if (!company) return;
    void listLedgers().then((list) => {
      setLedgers(list);
      const firstBank = list.find((l) => l.is_cash_bank);
      if (firstBank) setBankLedgerId(firstBank.id);
    });
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
  if (!allowed("create_voucher")) {
    return (
      <div className="page">
        <p className="muted">You don't have permission to create vouchers.</p>
      </div>
    );
  }

  async function onFile(file: File) {
    setError(null);
    try {
      const grid = await readStatementFile(file);
      setRows(grid);
      setFileName(file.name);
      setMapping(guessMapping(grid));
      setStep("mapping");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const preview = useMemo(() => {
    if (!mapping || mapping.date < 0 || mapping.narration < 0) return null;
    return applyMapping(rows, mapping);
  }, [rows, mapping]);

  async function goReview() {
    if (!preview || preview.txns.length === 0) {
      setError("No transactions found with this column mapping.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const [rules, existing] = await Promise.all([
        getBankRules(),
        fetchImportedHashes(),
      ]);
      const sugg = new Map<string, string>();
      const prepared: ImportRow[] = preview.txns.map((txn) => {
        const hash = txnHash(txn);
        const duplicate = existing.has(hash);
        const suggestion = suggestLedger(txn.narration, rules, counterLedgers);
        if (suggestion) sugg.set(hash, suggestion.label);
        return {
          ...txn,
          hash,
          duplicate,
          excluded: duplicate,
          ledgerId: duplicate ? null : (suggestion?.ledgerId ?? null),
        };
      });
      setTxnRows(prepared);
      setSuggestions(sugg);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function updateRow(hash: string, patch: Partial<ImportRow>) {
    setTxnRows((prev) =>
      prev.map((r) => (r.hash === hash ? { ...r, ...patch } : r)),
    );
  }

  function setAllIncluded(included: boolean) {
    setTxnRows((prev) =>
      prev.map((r) => (r.duplicate ? r : { ...r, excluded: !included })),
    );
  }

  function applyBulk() {
    if (!bulkLedgerId) return;
    setTxnRows((prev) =>
      prev.map((r) =>
        !r.excluded && !r.ledgerId ? { ...r, ledgerId: bulkLedgerId } : r,
      ),
    );
  }

  const readyRows = txnRows.filter(
    (r) => !r.excluded && !r.duplicate && r.ledgerId,
  );
  const unmappedCount = txnRows.filter(
    (r) => !r.excluded && !r.duplicate && !r.ledgerId,
  ).length;
  const duplicateCount = txnRows.filter((r) => r.duplicate).length;

  async function runImport() {
    if (!bankLedgerId) {
      setError("Pick the bank ledger this statement belongs to.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await importRows(txnRows, bankLedgerId);
      // Learn ledger choices so future imports suggest them automatically.
      for (const r of txnRows) {
        if (r.ledgerId && !r.excluded && !r.duplicate) {
          const pattern = normalizeNarration(r.narration)
            .split(" ")
            .slice(0, 5)
            .join(" ");
          await saveBankRule(pattern, r.ledgerId);
        }
      }
      setSummary(result);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Bank statement import</h1>
          <p className="lede">
            Turn a bank statement into payment &amp; receipt vouchers.
          </p>
        </div>
        <Link className="ghost btn" to="/vouchers">
          Back to vouchers
        </Link>
      </header>

      {error && <p className="error-text">{error}</p>}

      {step === "upload" && (
        <section className="panel" style={{ maxWidth: 560 }}>
          <div className="form-grid">
            <label>
              Statement file (.csv, .xlsx, .xls)
              <input
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
            <label>
              Bank ledger (the account this statement is from)
              <select
                value={bankLedgerId}
                onChange={(e) => setBankLedgerId(Number(e.target.value))}
              >
                {bankLedgers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small" style={{ marginTop: "0.8rem" }}>
            Works with exports from most Indian banks — HDFC, SBI, ICICI, Axis,
            Kotak and others. Deposits become receipts, withdrawals become
            payments. PDF statements are not supported yet — export CSV or
            Excel from net-banking instead.
          </p>
        </section>
      )}

      {step === "mapping" && (
        <section className="panel" style={{ maxWidth: 720 }}>
          <div className="row-between" style={{ marginBottom: "0.8rem" }}>
            <h2 style={{ margin: 0 }}>Match the columns</h2>
            <span className="muted small">{fileName}</span>
          </div>
          {mapping ? (
            <MappingForm
              rows={rows}
              mapping={mapping}
              onChange={setMapping}
            />
          ) : (
            <p className="muted">
              Couldn't detect the layout automatically — set up the columns
              manually.
              <button
                type="button"
                className="ghost btn"
                style={{ marginLeft: "0.6rem" }}
                onClick={() =>
                  setMapping({
                    headerRow: 1,
                    date: 0,
                    narration: 1,
                    reference: null,
                    debit: null,
                    credit: null,
                    amount: null,
                  })
                }
              >
                Set up manually
              </button>
            </p>
          )}
          {preview && (
            <p className="muted small" style={{ marginTop: "0.6rem" }}>
              Found {preview.txns.length} transaction
              {preview.txns.length === 1 ? "" : "s"}
              {preview.skipped.length
                ? ` · ${preview.skipped.length} row(s) skipped (unreadable date or amount)`
                : ""}
            </p>
          )}
          <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.6rem" }}>
            <button
              type="button"
              className="ghost btn"
              onClick={() => setStep("upload")}
            >
              Back
            </button>
            <button
              type="button"
              className="primary btn"
              disabled={!preview || preview.txns.length === 0 || busy}
              onClick={() => void goReview()}
            >
              Review transactions
            </button>
          </div>
        </section>
      )}

      {step === "review" && (
        <section className="panel">
          <div className="row-between" style={{ marginBottom: "0.7rem" }}>
            <h2 style={{ margin: 0 }}>Review &amp; import</h2>
            <span className="muted small">
              {readyRows.length} ready · {unmappedCount} need a ledger ·{" "}
              {duplicateCount} already imported
            </span>
          </div>

          {unmappedCount > 0 && (
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                marginBottom: "0.7rem",
                alignItems: "center",
              }}
            >
              <select
                value={bulkLedgerId}
                onChange={(e) => setBulkLedgerId(Number(e.target.value))}
                style={{ maxWidth: 280 }}
              >
                <option value={0}>Set all unmapped to…</option>
                {counterLedgers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="ghost btn"
                onClick={applyBulk}
                disabled={!bulkLedgerId}
              >
                Apply
              </button>
            </div>
          )}

          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={txnRows.every((r) => r.duplicate || !r.excluded)}
                      onChange={(e) => setAllIncluded(e.target.checked)}
                      title="Include/exclude all"
                    />
                  </th>
                  <th>Date</th>
                  <th>Narration</th>
                  <th className="num">In</th>
                  <th className="num">Out</th>
                  <th>Counter-ledger</th>
                </tr>
              </thead>
              <tbody>
                {txnRows.map((r) => (
                  <tr
                    key={r.hash + r.rawIndex}
                    className={r.duplicate || r.excluded ? "muted" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={!r.excluded}
                        disabled={r.duplicate}
                        onChange={(e) =>
                          updateRow(r.hash, { excluded: !e.target.checked })
                        }
                      />
                    </td>
                    <td>{r.date}</td>
                    <td>
                      <div style={{ maxWidth: 340 }}>
                        <div className="ellipsis">{r.narration}</div>
                        <div className="muted small">
                          {r.reference && <>Ref {r.reference} · </>}
                          {r.duplicate ? (
                            <span className="warn-text">already imported</span>
                          ) : (
                            suggestions.get(r.hash) || ""
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="num">
                      {r.deposit > 0 ? formatInr(r.deposit) : ""}
                    </td>
                    <td className="num">
                      {r.withdrawal > 0 ? formatInr(r.withdrawal) : ""}
                    </td>
                    <td>
                      <select
                        style={{ minWidth: 160, width: "100%" }}
                        value={r.ledgerId ?? 0}
                        disabled={r.duplicate || r.excluded}
                        onChange={(e) =>
                          updateRow(r.hash, {
                            ledgerId: Number(e.target.value) || null,
                          })
                        }
                      >
                        <option value={0}>— pick ledger —</option>
                        {counterLedgers.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.6rem" }}>
            <button
              type="button"
              className="ghost btn"
              onClick={() => setStep("mapping")}
            >
              Back
            </button>
            <button
              type="button"
              className="primary btn"
              disabled={readyRows.length === 0 || busy || !bankLedgerId}
              onClick={() => void runImport()}
            >
              {busy
                ? "Importing…"
                : `Import ${readyRows.length} voucher${readyRows.length === 1 ? "" : "s"}`}
            </button>
          </div>
        </section>
      )}

      {step === "done" && summary && (
        <section className="panel" style={{ maxWidth: 560 }}>
          <h2>Import complete</h2>
          <p>
            <strong>{summary.posted}</strong> voucher
            {summary.posted === 1 ? "" : "s"} posted
            {summary.skipped > 0 && (
              <span className="muted"> · {summary.skipped} skipped</span>
            )}
          </p>
          {summary.errors.length > 0 && (
            <>
              <p className="error-text">{summary.errors.length} row(s) failed:</p>
              <ul className="small">
                {summary.errors.slice(0, 5).map((err, i) => (
                  <li key={i}>
                    <span className="muted">{err.narration.slice(0, 60)}</span> —{" "}
                    {err.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">
            Your ledger choices were remembered — next time the same narrations
            will be suggested automatically.
          </p>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button
              type="button"
              className="ghost btn"
              onClick={() => {
                setStep("upload");
                setSummary(null);
                setTxnRows([]);
                setRows([]);
                setMapping(null);
                setError(null);
              }}
            >
              Import another
            </button>
            <button
              type="button"
              className="primary btn"
              onClick={() => navigate("/vouchers")}
            >
              View vouchers
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function MappingForm({
  rows,
  mapping,
  onChange,
}: {
  rows: SheetRows;
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const columnCount = Math.max(...rows.slice(0, 20).map((r) => r.length), 1);
  const options = Array.from({ length: columnCount }, (_, i) => (
    <option key={i} value={i}>
      {columnLabel(rows, mapping.headerRow, i)}
    </option>
  ));

  function field(
    label: string,
    key: keyof Omit<ColumnMapping, "headerRow">,
    optional = false,
  ) {
    return (
      <label>
        {label}
        <select
          value={mapping[key] ?? (optional ? -1 : 0)}
          onChange={(e) => {
            const v = Number(e.target.value);
            onChange({ ...mapping, [key]: optional && v < 0 ? null : v });
          }}
        >
          {optional && <option value={-1}>— none —</option>}
          {options}
        </select>
      </label>
    );
  }

  return (
    <div className="form-grid">
      <label>
        Data starts on row
        <input
          type="number"
          min={1}
          value={mapping.headerRow + 1}
          onChange={(e) =>
            onChange({
              ...mapping,
              headerRow: Math.max(0, Number(e.target.value) - 1),
            })
          }
          style={{ width: 90 }}
        />
      </label>
      {field("Date column", "date")}
      {field("Narration / description column", "narration")}
      {field("Reference / UTR column", "reference", true)}
      {field("Withdrawal (debit) column", "debit", true)}
      {field("Deposit (credit) column", "credit", true)}
      {field("OR single amount column", "amount", true)}
      <p className="muted small" style={{ gridColumn: "1 / -1" }}>
        Use either separate withdrawal/deposit columns, or one signed amount
        column (negative = money out).
      </p>
    </div>
  );
}
