import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { GST_RATES } from "../lib/accounting/gst";
import {
  createGodown,
  createStockItem,
  createUnit,
  listGodowns,
  listStockItems,
  listUnits,
  postStockJournal,
  type GodownRow,
  type StockItemRow,
  type UnitRow,
} from "../lib/db/inventory";
import { useApp } from "../state/AppContext";

type Tab = "items" | "units" | "godowns" | "journal";

export function InventoryPage() {
  const { company, allowed } = useApp();
  const [tab, setTab] = useState<Tab>("items");
  const [items, setItems] = useState<StockItemRow[]>([]);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [itemName, setItemName] = useState("");
  const [itemUnit, setItemUnit] = useState<number | "">("");
  const [purchaseRate, setPurchaseRate] = useState("0");
  const [salesRate, setSalesRate] = useState("0");
  const [openingQty, setOpeningQty] = useState("0");
  const [itemHsn, setItemHsn] = useState("");
  const [itemSku, setItemSku] = useState("");
  const [itemGst, setItemGst] = useState(18);

  const [unitName, setUnitName] = useState("");
  const [unitSymbol, setUnitSymbol] = useState("");
  const [godownName, setGodownName] = useState("");

  const [jDate, setJDate] = useState(new Date().toISOString().slice(0, 10));
  const [jItem, setJItem] = useState<number | "">("");
  const [jGodown, setJGodown] = useState<number | "">("");
  const [jQty, setJQty] = useState("1");
  const [jDir, setJDir] = useState<"in" | "out">("in");
  const [jRate, setJRate] = useState("0");
  const [jNarration, setJNarration] = useState("");

  async function refresh() {
    setItems(await listStockItems());
    setUnits(await listUnits());
    const g = await listGodowns();
    setGodowns(g);
    if (!jGodown && g[0]) setJGodown(g[0].id);
    if (!itemUnit && units.length === 0) {
      const u = await listUnits();
      if (u[0]) setItemUnit(u[0].id);
    }
  }

  useEffect(() => {
    if (company) void refresh().catch((e) => setError(String(e)));
  }, [company]);

  useEffect(() => {
    if (units[0] && !itemUnit) setItemUnit(units[0].id);
  }, [units, itemUnit]);

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  if (!allowed("manage_inventory")) {
    return (
      <div className="page">
        <p className="muted">You do not have permission to manage inventory.</p>
      </div>
    );
  }

  async function onCreateItem(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createStockItem({
        name: itemName,
        unitId: Number(itemUnit),
        purchaseRate: Number(purchaseRate) || 0,
        salesRate: Number(salesRate) || 0,
        openingQty: Number(openingQty) || 0,
        hsnSac: itemHsn || undefined,
        sku: itemSku || undefined,
        gstRate: itemGst,
        openingGodownId: godowns.find((g) => g.is_default)?.id || godowns[0]?.id,
      });
      setItemName("");
      setItemSku("");
      setOpeningQty("0");
      setNotice("Item saved.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onCreateUnit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createUnit(unitName, unitSymbol);
      setUnitName("");
      setUnitSymbol("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onCreateGodown(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createGodown(godownName);
      setGodownName("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onJournal(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const item = items.find((i) => i.id === Number(jItem));
      await postStockJournal({
        date: jDate,
        narration: jNarration || undefined,
        lines: [
          {
            itemId: Number(jItem),
            godownId: Number(jGodown),
            qty: Number(jQty) || 0,
            direction: jDir,
            rate: Number(jRate) || item?.purchase_rate || 0,
          },
        ],
      });
      setNotice("Stock journal posted.");
      setJQty("1");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Inventory</h1>
          <p className="lede">
            Items valued at fixed purchase rate. Sales/purchase vouchers can move
            stock; journals adjust quantity only.
          </p>
        </div>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="tabs">
        {(
          [
            ["items", "Items"],
            ["units", "Units"],
            ["godowns", "Godowns"],
            ["journal", "Stock journal"],
          ] as const
        ).map(([id, label]) => (
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

      {tab === "items" && (
        <div className="grid-2">
          <section className="panel">
            <h2>Stock items</h2>
            {items.length === 0 ? (
              <p className="muted">No items yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>SKU</th>
                    <th>Unit</th>
                    <th className="num">Purchase rate</th>
                    <th className="num">Sales rate</th>
                    <th>HSN</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td className="mono small">{i.sku || "—"}</td>
                      <td>{i.unit_symbol}</td>
                      <td className="num">{formatInr(i.purchase_rate)}</td>
                      <td className="num">{formatInr(i.sales_rate)}</td>
                      <td className="muted small">{i.hsn_sac || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="panel">
            <h2>Add item</h2>
            <form className="form" onSubmit={onCreateItem}>
              <label>
                Name
                <input value={itemName} onChange={(e) => setItemName(e.target.value)} required />
              </label>
              <label>
                SKU (for Shopify / Woo match)
                <input
                  value={itemSku}
                  onChange={(e) => setItemSku(e.target.value)}
                  placeholder="Matches store product SKU"
                />
              </label>
              <label>
                Unit
                <select
                  value={itemUnit}
                  onChange={(e) => setItemUnit(Number(e.target.value))}
                  required
                >
                  <option value="">Select</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.symbol})
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-row">
                <label>
                  Purchase rate
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={purchaseRate}
                    onChange={(e) => setPurchaseRate(e.target.value)}
                  />
                </label>
                <label>
                  Sales rate
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={salesRate}
                    onChange={(e) => setSalesRate(e.target.value)}
                  />
                </label>
              </div>
              <div className="form-row">
                <label>
                  Opening qty
                  <input
                    type="number"
                    min="0"
                    step="0.001"
                    value={openingQty}
                    onChange={(e) => setOpeningQty(e.target.value)}
                  />
                </label>
                <label>
                  GST %
                  <select
                    value={itemGst}
                    onChange={(e) => setItemGst(Number(e.target.value))}
                  >
                    {GST_RATES.map((r) => (
                      <option key={r} value={r}>
                        {r}%
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                HSN / SAC
                <input value={itemHsn} onChange={(e) => setItemHsn(e.target.value)} />
              </label>
              <button className="primary" type="submit">
                Save item
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === "units" && (
        <div className="grid-2">
          <section className="panel">
            <h2>Units</h2>
            <ul className="list">
              {units.map((u) => (
                <li key={u.id} className="list-row">
                  <span>{u.name}</span>
                  <span className="muted">{u.symbol}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Add unit</h2>
            <form className="form" onSubmit={onCreateUnit}>
              <label>
                Name
                <input value={unitName} onChange={(e) => setUnitName(e.target.value)} required />
              </label>
              <label>
                Symbol
                <input value={unitSymbol} onChange={(e) => setUnitSymbol(e.target.value)} required />
              </label>
              <button className="primary" type="submit">
                Save unit
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === "godowns" && (
        <div className="grid-2">
          <section className="panel">
            <h2>Godowns</h2>
            <ul className="list">
              {godowns.map((g) => (
                <li key={g.id} className="list-row">
                  <span>{g.name}</span>
                  <span className="muted small">{g.is_default ? "Default" : ""}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h2>Add godown</h2>
            <form className="form" onSubmit={onCreateGodown}>
              <label>
                Name
                <input value={godownName} onChange={(e) => setGodownName(e.target.value)} required />
              </label>
              <button className="primary" type="submit">
                Save godown
              </button>
            </form>
          </section>
        </div>
      )}

      {tab === "journal" && (
        <section className="panel narrow">
          <h2>Stock journal</h2>
          <p className="muted small">
            Adjust on-hand quantity without a sales/purchase voucher. Outwards
            are blocked if stock is insufficient.
          </p>
          <form className="form" onSubmit={onJournal}>
            <label>
              Date
              <input type="date" value={jDate} onChange={(e) => setJDate(e.target.value)} />
            </label>
            <label>
              Item
              <select value={jItem} onChange={(e) => setJItem(Number(e.target.value))} required>
                <option value="">Select</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Godown
              <select
                value={jGodown}
                onChange={(e) => setJGodown(Number(e.target.value))}
                required
              >
                {godowns.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-row">
              <label>
                Direction
                <select
                  value={jDir}
                  onChange={(e) => setJDir(e.target.value as "in" | "out")}
                >
                  <option value="in">In (+)</option>
                  <option value="out">Out (−)</option>
                </select>
              </label>
              <label>
                Qty
                <input
                  type="number"
                  min="0.001"
                  step="0.001"
                  value={jQty}
                  onChange={(e) => setJQty(e.target.value)}
                  required
                />
              </label>
              <label>
                Rate
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={jRate}
                  onChange={(e) => setJRate(e.target.value)}
                />
              </label>
            </div>
            <label>
              Narration
              <input value={jNarration} onChange={(e) => setJNarration(e.target.value)} />
            </label>
            <button className="primary" type="submit">
              Post journal
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
