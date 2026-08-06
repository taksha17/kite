import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  collectAnomalies,
  type Anomaly,
} from "../lib/accounting/anomalies";
import { listVouchers } from "../lib/db/client";
import { useApp } from "../state/AppContext";

export function AnomaliesPage() {
  const { company } = useApp();
  const [items, setItems] = useState<Anomaly[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!company) return;
    setLoading(true);
    setError(null);
    void listVouchers(500)
      .then((vouchers) => setItems(collectAnomalies(vouchers)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
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

  const warns = items.filter((i) => i.severity === "warn").length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Anomaly watch</h1>
          <p className="lede">
            Rules scan recent vouchers for duplicate numbers, unusual amounts,
            and weekend entries — review before you worry.
          </p>
        </div>
        <Link className="ghost btn" to="/period-close">
          Period close
        </Link>
      </header>

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="muted">Scanning vouchers…</p>}

      {!loading && items.length === 0 && (
        <section className="panel" style={{ maxWidth: 560 }}>
          <p className="muted">
            Nothing unusual in the last 500 vouchers. Nice clean books.
          </p>
        </section>
      )}

      {!loading && items.length > 0 && (
        <section className="panel">
          <p className="muted small" style={{ marginTop: 0 }}>
            {items.length} flag{items.length === 1 ? "" : "s"}
            {warns > 0 ? ` · ${warns} higher priority` : ""}
          </p>
          <ul className="checklist">
            {items.map((a) => (
              <li
                key={a.id}
                className={`checklist-item status-${a.severity === "warn" ? "warn" : "ok"}`}
              >
                <div>
                  <strong>{a.title}</strong>
                  <span className="muted small" style={{ display: "block" }}>
                    {a.detail}
                  </span>
                </div>
                <Link className="ghost btn" to={a.href}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
