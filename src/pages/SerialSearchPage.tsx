import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { searchVouchersBySerialNo, type SerialSearchRow } from "../lib/db/client";
import { useApp } from "../state/AppContext";

const TYPE_LABEL: Record<string, string> = {
  payment: "Payment",
  receipt: "Receipt",
  contra: "Contra",
  journal: "Journal",
  sales: "Sales",
  purchase: "Purchase",
  stock_journal: "Stock Journal",
};

export function SerialSearchPage() {
  const { company } = useApp();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SerialSearchRow[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!company) return;
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

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearched(true);
    const rows = await searchVouchersBySerialNo(query.trim());
    setResults(rows);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Search by serial number</h1>
          <p className="lede">
            Find an invoice or voucher by product serial number, batch number,
            or item name.
          </p>
        </div>
      </header>

      <form className="panel" onSubmit={onSearch} style={{ marginBottom: "1rem" }}>
        <label>
          Serial / batch / item
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. SN12345 or batch-001 or Mouse"
            autoFocus
          />
        </label>
        <div className="cta-row" style={{ marginTop: "0.75rem" }}>
          <button className="primary" type="submit">
            Search
          </button>
          {searched && (
            <button
              className="ghost"
              type="button"
              onClick={() => {
                setQuery("");
                setResults([]);
                setSearched(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {searched && results.length === 0 && (
        <section className="panel">
          <p className="muted">No vouchers found for &ldquo;{query.trim()}&rdquo;.</p>
        </section>
      )}

      {results.length > 0 && (
        <section className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Voucher</th>
                <th>Party</th>
                <th>Item</th>
                <th>Serial / batch</th>
                <th className="num">Qty</th>
                <th className="num">Rate</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={`${r.voucher_id}-${r.serial_no}-${r.item_name}`}>
                  <td>{r.date}</td>
                  <td>{TYPE_LABEL[r.voucher_type] || r.voucher_type}</td>
                  <td>
                    <strong>#{r.voucher_id}</strong>
                    {r.number ? ` · ${r.number}` : ""}
                  </td>
                  <td>{r.party_name || "—"}</td>
                  <td>{r.item_name}</td>
                  <td>
                    <div>{r.serial_no || "—"}</div>
                    {r.batch_no && (
                      <div className="muted small">Batch: {r.batch_no}</div>
                    )}
                  </td>
                  <td className="num">{r.qty}</td>
                  <td className="num">{formatInr(r.rate)}</td>
                  <td className="num">{formatInr(r.total_amount)}</td>
                  <td>
                    <span style={{ display: "inline-flex", gap: "0.35rem" }}>
                      {r.voucher_type === "sales" && (
                        <Link className="ghost btn" to={`/vouchers/${r.voucher_id}/invoice`}>
                          Invoice
                        </Link>
                      )}
                      <Link className="secondary btn" to={`/vouchers/${r.voucher_id}/edit`}>
                        Edit
                      </Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
