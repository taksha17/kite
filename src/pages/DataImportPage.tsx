import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { applyLedgerImport, applyStockImport } from "../lib/dataimport/apply";
import {
  columnLabel,
  guessColumnMap,
  guessSheetKind,
  maxColumns,
  readImportFile,
} from "../lib/dataimport/parse";
import {
  prepareLedgerRows,
  prepareStockRows,
  recountStatuses,
} from "../lib/dataimport/prepare";
import { downloadImportTemplate } from "../lib/dataimport/templates";
import type {
  ImportKind,
  ImportSummary,
  MastersColumnMap,
  PreparedLedgerRow,
  PreparedStockRow,
  SheetRows,
} from "../lib/dataimport/types";
import { listGroups, listLedgers } from "../lib/db/client";
import type { AccountGroupRow } from "../lib/db/types";
import { listStockItems } from "../lib/db/inventory";
import { useApp } from "../state/AppContext";

type Step = "upload" | "mapping" | "review" | "done";

function emptyMap(): MastersColumnMap {
  return {
    headerRow: 1,
    name: 0,
    group: null,
    kind: null,
    opening: null,
    openingDebit: null,
    openingCredit: null,
    gstin: null,
    state: null,
    email: null,
    phone: null,
    address: null,
    city: null,
    pin: null,
    isCashBank: null,
    unit: null,
    hsn: null,
    sku: null,
    gstRate: null,
    purchaseRate: null,
    salesRate: null,
    openingQty: null,
  };
}

export function DataImportPage() {
  const { company, allowed } = useApp();

  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ImportKind>("ledgers");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<SheetRows>([]);
  const [mapping, setMapping] = useState<MastersColumnMap>(emptyMap());
  const [groups, setGroups] = useState<AccountGroupRow[]>([]);
  const [ledgerRows, setLedgerRows] = useState<PreparedLedgerRow[]>([]);
  const [stockRows, setStockRows] = useState<PreparedStockRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const colCount = useMemo(() => Math.max(maxColumns(rows), 1), [rows]);
  const colOptions = useMemo(() => {
    const opts: { value: number; label: string }[] = [
      { value: -1, label: "— not used —" },
    ];
    for (let i = 0; i < colCount; i++) {
      opts.push({ value: i, label: columnLabel(rows, mapping.headerRow, i) });
    }
    return opts;
  }, [rows, colCount, mapping.headerRow]);

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
        <p className="muted">You need ledger permission to import masters.</p>
      </div>
    );
  }

  async function onFile(file: File | null) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const grid = await readImportFile(file);
      if (!grid.length) throw new Error("File looks empty.");
      const guessed = guessSheetKind(grid);
      setKind(guessed);
      const map = guessColumnMap(grid, guessed) || {
        ...emptyMap(),
        headerRow: 1,
        name: 0,
      };
      setRows(grid);
      setMapping(map);
      setFileName(file.name);
      setStep("mapping");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function buildReview() {
    setError(null);
    if (mapping.name < 0) {
      setError("Map the Name column.");
      return;
    }
    setBusy(true);
    try {
      if (kind === "stock") {
        if (!allowed("manage_inventory")) {
          throw new Error("You need inventory permission to import stock.");
        }
        const existing = new Set(
          (await listStockItems()).map((i) => i.name.toLowerCase()),
        );
        setStockRows(prepareStockRows(rows, mapping, existing));
        setLedgerRows([]);
      } else {
        const existing = new Set(
          (await listLedgers()).map((l) => l.name.toLowerCase()),
        );
        setLedgerRows(
          prepareLedgerRows(rows, mapping, kind, groups, existing),
        );
        setStockRows([]);
      }
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
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

  function setCol(key: keyof MastersColumnMap, value: number) {
    setMapping((m) => ({
      ...m,
      [key]: value < 0 && key !== "name" && key !== "headerRow" ? null : value,
    }));
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
          <h1>Data import</h1>
          <p className="lede">
            Migrate ledgers, parties, and stock (with openings) from Excel/CSV —
            including exports from Tally and similar tools. Review before
            anything is created.
          </p>
        </div>
        <Link className="ghost btn" to="/ledgers">
          Ledgers
        </Link>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {step === "upload" && (
        <section className="panel">
          <h2>1. Upload a sheet</h2>
          <p className="muted small">
            One sheet at a time. Download a template, or export masters from
            TallyPrime to Excel and upload here.{" "}
            <a
              href="https://github.com/taksha17/kite/blob/main/docs/data-import.md"
              target="_blank"
              rel="noreferrer"
            >
              How to export from Tally
            </a>
          </p>
          <div className="cta-row" style={{ marginTop: "0.75rem", flexWrap: "wrap" }}>
            <button
              type="button"
              className="ghost btn"
              onClick={() => downloadImportTemplate("ledgers")}
            >
              Template: ledgers
            </button>
            <button
              type="button"
              className="ghost btn"
              onClick={() => downloadImportTemplate("parties")}
            >
              Template: parties
            </button>
            <button
              type="button"
              className="ghost btn"
              onClick={() => downloadImportTemplate("stock")}
            >
              Template: stock
            </button>
          </div>
          <label style={{ display: "block", marginTop: "1rem" }}>
            File (CSV / Excel)
            <input
              type="file"
              accept=".csv,.tsv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => void onFile(e.target.files?.[0] || null)}
            />
          </label>
        </section>
      )}

      {step === "mapping" && (
        <section className="panel">
          <h2>2. Map columns</h2>
          <p className="muted small">
            File: <strong>{fileName}</strong> · {rows.length} rows
          </p>
          <div className="form-row" style={{ marginTop: "0.75rem" }}>
            <label>
              Import as
              <select
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as ImportKind;
                  setKind(k);
                  const map = guessColumnMap(rows, k);
                  if (map) setMapping(map);
                }}
              >
                <option value="ledgers">Ledgers (with openings)</option>
                <option value="parties">Parties / debtors &amp; creditors</option>
                <option value="stock">Stock items</option>
              </select>
            </label>
            <label>
              First data row (1-based)
              <input
                type="number"
                min={1}
                value={mapping.headerRow}
                onChange={(e) =>
                  setMapping((m) => ({
                    ...m,
                    headerRow: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
              />
            </label>
          </div>

          <div className="form-grid" style={{ marginTop: "0.75rem" }}>
            <MapSelect
              label="Name *"
              value={mapping.name}
              options={colOptions.filter((o) => o.value >= 0)}
              onChange={(v) => setCol("name", v)}
            />
            {kind !== "stock" && (
              <>
                <MapSelect
                  label="Group / Under"
                  value={mapping.group ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("group", v)}
                />
                {kind === "parties" && (
                  <MapSelect
                    label="Kind (debtor/creditor)"
                    value={mapping.kind ?? -1}
                    options={colOptions}
                    onChange={(v) => setCol("kind", v)}
                  />
                )}
                <MapSelect
                  label="Opening (signed)"
                  value={mapping.opening ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("opening", v)}
                />
                <MapSelect
                  label="Opening debit"
                  value={mapping.openingDebit ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("openingDebit", v)}
                />
                <MapSelect
                  label="Opening credit"
                  value={mapping.openingCredit ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("openingCredit", v)}
                />
                <MapSelect
                  label="GSTIN"
                  value={mapping.gstin ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("gstin", v)}
                />
                <MapSelect
                  label="State"
                  value={mapping.state ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("state", v)}
                />
              </>
            )}
            {kind === "stock" && (
              <>
                <MapSelect
                  label="Unit"
                  value={mapping.unit ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("unit", v)}
                />
                <MapSelect
                  label="HSN / SAC"
                  value={mapping.hsn ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("hsn", v)}
                />
                <MapSelect
                  label="GST %"
                  value={mapping.gstRate ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("gstRate", v)}
                />
                <MapSelect
                  label="Purchase rate"
                  value={mapping.purchaseRate ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("purchaseRate", v)}
                />
                <MapSelect
                  label="Sales rate"
                  value={mapping.salesRate ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("salesRate", v)}
                />
                <MapSelect
                  label="Opening qty"
                  value={mapping.openingQty ?? -1}
                  options={colOptions}
                  onChange={(v) => setCol("openingQty", v)}
                />
              </>
            )}
          </div>

          <div className="cta-row" style={{ marginTop: "1rem" }}>
            <button type="button" className="ghost btn" onClick={() => setStep("upload")}>
              Back
            </button>
            <button
              type="button"
              className="primary btn"
              disabled={busy}
              onClick={() => void buildReview()}
            >
              Continue to review
            </button>
          </div>
        </section>
      )}

      {step === "review" && (
        <section className="panel">
          <h2>3. Review</h2>
          <p className="muted small">
            Ready: {counts.ready} · Skip (duplicate): {counts.skip} · Need fix:{" "}
            {counts.error}
          </p>

          {kind !== "stock" ? (
            <div className="table-wrap" style={{ marginTop: "0.75rem", overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Group</th>
                    <th>Opening Dr</th>
                    <th>Opening Cr</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((row, idx) => (
                    <tr key={`${row.name}-${idx}`}>
                      <td>{row.name}</td>
                      <td>
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
            <div className="table-wrap" style={{ marginTop: "0.75rem", overflowX: "auto" }}>
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
            <button type="button" className="ghost btn" onClick={() => setStep("mapping")}>
              Back
            </button>
            <button
              type="button"
              className="primary btn"
              disabled={busy || counts.ready === 0}
              onClick={() => void runImport()}
            >
              {busy ? "Importing…" : `Import ${counts.ready} row(s)`}
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
                setStep("upload");
                setRows([]);
                setSummary(null);
                setFileName("");
              }}
            >
              Import another sheet
            </button>
            <Link className="ghost btn" to={kind === "stock" ? "/inventory" : "/ledgers"}>
              Open {kind === "stock" ? "Inventory" : "Ledgers"}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

function MapSelect(props: {
  label: string;
  value: number;
  options: { value: number; label: string }[];
  onChange: (v: number) => void;
}) {
  return (
    <label>
      {props.label}
      <select
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      >
        {props.options.map((o) => (
          <option key={`${props.label}-${o.value}`} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
