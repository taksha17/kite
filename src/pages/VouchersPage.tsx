import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { listVouchers, type VoucherRow } from "../lib/db/client";
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

export function VouchersPage() {
  const { company } = useApp();
  const [rows, setRows] = useState<VoucherRow[]>([]);

  useEffect(() => {
    if (!company) return;
    void listVouchers().then(setRows);
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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Vouchers</h1>
          <p className="lede">Day book of accepted entries.</p>
        </div>
        <Link className="primary btn" to="/vouchers/new">
          New voucher
        </Link>
      </header>

      <section className="panel">
        {rows.length === 0 ? (
          <p className="muted">No vouchers yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Number</th>
                <th>Narration</th>
                <th className="num">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>{v.date}</td>
                  <td>{TYPE_LABEL[v.voucher_type] || v.voucher_type}</td>
                  <td>{v.number || "—"}</td>
                  <td>{v.narration || "—"}</td>
                  <td className="num">{formatInr(v.total_amount)}</td>
                  <td>
                    {v.voucher_type === "sales" && (
                      <Link className="ghost btn" to={`/vouchers/${v.id}/invoice`}>
                        Invoice
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
