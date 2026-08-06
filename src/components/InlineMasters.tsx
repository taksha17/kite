import { useEffect, useState } from "react";
import { GST_RATES, INDIA_STATES } from "../lib/accounting/gst";
import {
  createParty,
  findLedgerByName,
  updateLedger,
  type LedgerRow,
} from "../lib/db/client";
import {
  createStockItem,
  listStockItems,
  listUnits,
  updateStockItem,
  type StockItemRow,
  type UnitRow,
} from "../lib/db/inventory";

/**
 * Create/edit master records without leaving the current screen
 * (voucher editor, etc.). Renders as a compact sub-panel; the parent
 * decides placement and what happens with the saved row.
 */

export function InlinePartyForm({
  defaultKind,
  initial,
  onSaved,
  onCancel,
}: {
  defaultKind: "debtor" | "creditor";
  initial?: LedgerRow;
  onSaved: (ledger: LedgerRow) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [kind, setKind] = useState<"debtor" | "creditor">(
    initial
      ? initial.group_name === "Sundry Creditors"
        ? "creditor"
        : "debtor"
      : defaultKind,
  );
  const [stateCode, setStateCode] = useState(initial?.state_code || "29");
  const [gstin, setGstin] = useState(initial?.gstin || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (initial) {
        // Group (debtor/creditor) is fixed on edit — moving groups would
        // need to reclassify history; kind selector is hidden then.
        await updateLedger(initial.id, { name, gstin, stateCode, email });
      } else {
        await createParty({ name, kind, gstin, stateCode, email });
      }
      const row = await findLedgerByName(name.trim());
      if (!row) throw new Error("Saved, but could not reload the party.");
      await onSaved(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ margin: "0.5rem 0" }}>
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
        {initial ? `Edit party — ${initial.name}` : "New party"}
      </h3>
      <div className="form">
        <div className="form-row">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agarwal Traders"
              required
              autoFocus
            />
          </label>
          {!initial && (
            <label>
              Type
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as "debtor" | "creditor")}
              >
                <option value="debtor">Customer (Sundry Debtors)</option>
                <option value="creditor">Supplier (Sundry Creditors)</option>
              </select>
            </label>
          )}
          <label>
            State
            <select
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value)}
            >
              {INDIA_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            GSTIN (optional)
            <input
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              placeholder="29AAAAA0000A1Z5"
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="cta-row" style={{ marginTop: 0 }}>
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : initial ? "Save changes" : "Create party"}
          </button>
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function InlineItemForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: StockItemRow;
  onSaved: (item: StockItemRow) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [name, setName] = useState(initial?.name || "");
  const [unitId, setUnitId] = useState<number | "">(initial?.unit_id || "");
  const [salesRate, setSalesRate] = useState(String(initial?.sales_rate || 0));
  const [purchaseRate, setPurchaseRate] = useState(
    String(initial?.purchase_rate || 0),
  );
  const [gstRate, setGstRate] = useState(initial?.gst_rate ?? 18);
  const [hsn, setHsn] = useState(initial?.hsn_sac || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listUnits().then((rows) => {
      setUnits(rows);
      setUnitId((current) => current || rows[0]?.id || "");
    });
  }, []);

  async function save() {
    if (!name.trim() || !unitId) return;
    setBusy(true);
    setError(null);
    try {
      const fields = {
        name,
        unitId: Number(unitId),
        hsnSac: hsn || undefined,
        gstRate,
        purchaseRate: Number(purchaseRate) || 0,
        salesRate: Number(salesRate) || 0,
      };
      if (initial) {
        await updateStockItem(initial.id, fields);
      } else {
        await createStockItem(fields);
      }
      const items = await listStockItems();
      const row = items.find(
        (i) => (initial ? i.id === initial.id : i.name === name.trim()),
      );
      if (!row) throw new Error("Saved, but could not reload the item.");
      await onSaved(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ margin: "0.5rem 0" }}>
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>
        {initial ? `Edit item — ${initial.name}` : "New stock item"}
      </h3>
      <div className="form">
        <div className="form-row">
          <label>
            Item name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Wireless Mouse"
              required
              autoFocus
            />
          </label>
          <label>
            Unit
            <select
              value={unitId}
              onChange={(e) => setUnitId(Number(e.target.value))}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.symbol})
                </option>
              ))}
            </select>
          </label>
          <label>
            GST rate
            <select
              value={gstRate}
              onChange={(e) => setGstRate(Number(e.target.value))}
            >
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
          <label>
            Sales rate (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              value={salesRate}
              onChange={(e) => setSalesRate(e.target.value)}
            />
          </label>
          <label>
            Purchase rate (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              value={purchaseRate}
              onChange={(e) => setPurchaseRate(e.target.value)}
            />
          </label>
          <label>
            HSN (optional)
            <input
              value={hsn}
              onChange={(e) => setHsn(e.target.value)}
              placeholder="8471"
            />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="cta-row" style={{ marginTop: 0 }}>
          <button
            className="primary"
            type="button"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : initial ? "Save changes" : "Create item"}
          </button>
          <button type="button" className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
