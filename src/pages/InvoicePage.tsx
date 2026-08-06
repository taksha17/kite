import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { INDIA_STATES } from "../lib/accounting/gst";
import { extractPincode } from "../lib/ewaybill/buildPayload";
import { generateEwayBillForInvoice } from "../lib/ewaybill/client";
import {
  cancelIrnForInvoice,
  generateIrnForInvoice,
} from "../lib/einvoice/client";
import { fetchSalesInvoice } from "../lib/invoice/data";
import { emailSalesInvoice } from "../lib/invoice/email";
import { downloadSalesInvoicePdf } from "../lib/invoice/pdf";
import { irnQrDataUrl } from "../lib/invoice/qr";
import type { SalesInvoiceData } from "../lib/invoice/types";
import { isTauriRuntime } from "../lib/server/remote";
import { useApp } from "../state/AppContext";

function stateLabel(code: string): string {
  const hit = INDIA_STATES.find((s) => s.code === code);
  return hit ? `${code} — ${hit.name}` : code || "—";
}

export function InvoicePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { company } = useApp();
  const [data, setData] = useState<SalesInvoiceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toEmail, setToEmail] = useState("");
  const [ewbBusy, setEwbBusy] = useState(false);
  const [distanceKm, setDistanceKm] = useState("");
  const [ewbVehicle, setEwbVehicle] = useState("");
  const [transMode, setTransMode] = useState("1");
  const [fromPin, setFromPin] = useState("");
  const [toPin, setToPin] = useState("");
  const [einvBusy, setEinvBusy] = useState(false);
  const [irnQr, setIrnQr] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [cnlReason, setCnlReason] = useState("2");
  const [cnlRemark, setCnlRemark] = useState("");

  useEffect(() => {
    if (!company || !id) return;
    void fetchSalesInvoice(Number(id))
      .then((inv) => {
        setData(inv);
        setToEmail(inv.party.email || "");
        setEwbVehicle(inv.vehicleNo || "");
        setDistanceKm(inv.transDistance || "");
        const fp =
          extractPincode(inv.company.address)?.toString() || "";
        const tp =
          extractPincode(inv.shipTo.address || inv.party.address)?.toString() ||
          "";
        setFromPin(fp);
        setToPin(tp);
        if (searchParams.get("send") === "1") {
          setNotice(
            "Voucher saved. Email this invoice to the party (SMTP under Companies).",
          );
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [company, id, searchParams]);

  async function onDownload() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const path = await downloadSalesInvoicePdf(data);
      if (path) setNotice(`PDF saved to ${path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onEmail() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await emailSalesInvoice(data, toEmail);
      setNotice(`Invoice emailed to ${toEmail.trim()}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onPrint() {
    window.print();
  }

  useEffect(() => {
    let cancelled = false;
    if (data?.irnSignedQr && data.irnStatus !== "CNL") {
      void irnQrDataUrl(data.irnSignedQr).then((url) => {
        if (!cancelled) setIrnQr(url);
      });
    } else {
      setIrnQr("");
    }
    return () => {
      cancelled = true;
    };
  }, [data?.irnSignedQr, data?.irnStatus]);

  async function onGenerateEwb() {
    if (!data) return;
    setEwbBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await generateEwayBillForInvoice(data, {
        distanceKm,
        vehicleNo: ewbVehicle,
        transMode,
        vehicleType: "R",
        fromPincode: Number(fromPin),
        toPincode: Number(toPin),
      });
      const refreshed = await fetchSalesInvoice(data.voucherId);
      setData(refreshed);
      setNotice(
        `e-Way bill ${result.ewayBillNo} generated` +
          (result.validUpto ? ` · valid up to ${result.validUpto}` : "") +
          (result.alert ? ` · ${result.alert}` : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEwbBusy(false);
    }
  }

  async function onGenerateIrn() {
    if (!data) return;
    setEinvBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await generateIrnForInvoice(data);
      const refreshed = await fetchSalesInvoice(data.voucherId);
      setData(refreshed);
      setNotice(
        `e-Invoice registered — Ack ${result.ackNo || "—"} · ${result.ackDt || ""}`.trim(),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEinvBusy(false);
    }
  }

  async function onCancelIrn() {
    if (!data) return;
    setEinvBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await cancelIrnForInvoice(data, cnlReason, cnlRemark);
      const refreshed = await fetchSalesInvoice(data.voucherId);
      setData(refreshed);
      setShowCancel(false);
      setNotice(`IRN cancelled${result.cancelDate ? ` on ${result.cancelDate}` : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setEinvBusy(false);
    }
  }

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link className="secondary btn" to="/vouchers">
          Back to vouchers
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <p className="muted">Loading invoice…</p>
      </div>
    );
  }

  const shipName = data.shipTo.name || data.party.name;
  const shipAddr = data.shipTo.address || data.party.address;
  const shipState = data.shipTo.stateCode || data.party.stateCode;
  const shipGstin = data.shipTo.gstin || data.party.gstin;

  const subTaxable = data.lines.reduce((s, l) => s + l.taxable, 0);
  const subGst = data.lines.reduce((s, l) => s + l.gstAmount, 0);
  const subTotal = data.lines.reduce((s, l) => s + l.lineTotal, 0);
  const subQty = data.lines.reduce((s, l) => s + (l.qty || 0), 0);

  return (
    <div className="page invoice-page">
      <header className="page-header no-print">
        <div>
          <h1>Tax invoice</h1>
          <p className="lede">
            Preview for voucher #{data.voucherId}. Download, print, or email
            with PDF attached.
          </p>
        </div>
        <div className="cta-row">
          <Link className="ghost btn" to="/vouchers">
            Back
          </Link>
          <Link
            className="ghost btn"
            to={`/vouchers/${data.voucherId}/edit`}
            title={
              (data.irn && data.irnStatus !== "CNL") || data.ewbNo
                ? "Locked — cancel the IRN/e-way bill first"
                : "Edit this voucher"
            }
          >
            Edit
          </Link>
          <button type="button" className="secondary" onClick={onPrint}>
            Print invoice
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void onDownload()}
            disabled={busy}
          >
            {busy ? "Working…" : "Download PDF"}
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void onEmail()}
            disabled={busy}
          >
            Email invoice
          </button>
        </div>
      </header>

      {notice && <p className="notice no-print">{notice}</p>}
      {error && <p className="error no-print">{error}</p>}

      <section className="panel no-print" style={{ marginBottom: "1rem" }}>
        <label>
          Send to (party email)
          <input
            type="email"
            value={toEmail}
            onChange={(e) => setToEmail(e.target.value)}
            placeholder="party@example.com"
          />
        </label>
        <p className="muted small">
          Uses company SMTP From address. Configure under{" "}
          <Link to="/companies">Companies → Email (SMTP)</Link>.
        </p>
      </section>

      <section className="panel no-print" style={{ marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>e-Way bill</h2>
        {data.ewbNo ? (
          <div>
            <p>
              <strong>{data.ewbNo}</strong>
            </p>
            <p className="muted small">
              Generated {data.ewbDate || "—"}
              {data.ewbValidUpto ? ` · Valid up to ${data.ewbValidUpto}` : ""}
              {data.transDistance
                ? ` · Distance ${data.transDistance} km`
                : ""}
            </p>
          </div>
        ) : (
          <>
            <p className="muted small">
              Calls the NIC GENEWAYBILL API using credentials under{" "}
              <Link to="/companies">Companies → e-Way bill (NIC API)</Link>.
              Requires HSN on items, company GSTIN, and PIN codes.
            </p>
            <div className="form-row">
              <label>
                Distance (km)
                <input
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(e.target.value)}
                  placeholder="100"
                  inputMode="numeric"
                />
              </label>
              <label>
                Vehicle no.
                <input
                  value={ewbVehicle}
                  onChange={(e) => setEwbVehicle(e.target.value)}
                  placeholder="KA01AB1234"
                />
              </label>
              <label>
                Mode
                <select
                  value={transMode}
                  onChange={(e) => setTransMode(e.target.value)}
                >
                  <option value="1">Road</option>
                  <option value="2">Rail</option>
                  <option value="3">Air</option>
                  <option value="4">Ship</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                From PIN
                <input
                  value={fromPin}
                  onChange={(e) => setFromPin(e.target.value)}
                  placeholder="560001"
                  inputMode="numeric"
                  maxLength={6}
                />
              </label>
              <label>
                To PIN
                <input
                  value={toPin}
                  onChange={(e) => setToPin(e.target.value)}
                  placeholder="110001"
                  inputMode="numeric"
                  maxLength={6}
                />
              </label>
            </div>
            <button
              type="button"
              className="primary"
              disabled={ewbBusy || busy}
              onClick={() => void onGenerateEwb()}
            >
              {ewbBusy ? "Generating…" : "Generate e-way bill"}
            </button>
          </>
        )}
      </section>

      <section className="panel no-print" style={{ marginBottom: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>e-Invoice (IRN)</h2>
        {!isTauriRuntime() ? (
          <p className="muted small">
            e-Invoicing currently runs from the desktop app (the portal&apos;s
            RSA step needs the native crypto). Open this invoice in Kite Solo
            to generate the IRN.
          </p>
        ) : data.irn ? (
          <div>
            <p className="small" style={{ wordBreak: "break-all" }}>
              <strong>IRN:</strong>{" "}
              <span className="mono">{data.irn}</span>
            </p>
            <p className="muted small">
              Ack {data.irnAckNo || "—"} · {data.irnAckDate || "—"}
              {data.irnStatus === "CNL"
                ? ` · CANCELLED ${data.irnCancelDate || ""}`
                : " · Active"}
            </p>
            {data.irnStatus !== "CNL" && !showCancel && (
              <button
                type="button"
                className="ghost btn"
                disabled={einvBusy || busy}
                onClick={() => setShowCancel(true)}
              >
                Cancel IRN…
              </button>
            )}
            {data.irnStatus !== "CNL" && showCancel && (
              <div style={{ marginTop: "0.5rem" }}>
                <p className="muted small">
                  Cancellation is only possible within 24 hours of generation
                  (the portal enforces this).
                </p>
                <div className="form-row">
                  <label>
                    Reason
                    <select
                      value={cnlReason}
                      onChange={(e) => setCnlReason(e.target.value)}
                    >
                      <option value="1">Duplicate</option>
                      <option value="2">Data entry mistake</option>
                      <option value="3">Order cancelled</option>
                      <option value="4">Others</option>
                    </select>
                  </label>
                  <label>
                    Remark
                    <input
                      value={cnlRemark}
                      onChange={(e) => setCnlRemark(e.target.value)}
                      placeholder="Wrong GSTIN on party"
                      maxLength={100}
                    />
                  </label>
                </div>
                <div className="cta-row">
                  <button
                    type="button"
                    className="secondary"
                    disabled={einvBusy || busy || !cnlRemark.trim()}
                    onClick={() => void onCancelIrn()}
                  >
                    {einvBusy ? "Cancelling…" : "Confirm cancel IRN"}
                  </button>
                  <button
                    type="button"
                    className="ghost btn"
                    onClick={() => setShowCancel(false)}
                  >
                    Back
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <p className="muted small">
              Registers this B2B invoice with the e-invoice portal and prints
              the signed QR + IRN on the PDF. Uses credentials under{" "}
              <Link to="/companies">Companies → e-Invoice (IRP API)</Link>.
              Party must have a GSTIN and PIN code.
            </p>
            <button
              type="button"
              className="primary"
              disabled={einvBusy || busy}
              onClick={() => void onGenerateIrn()}
            >
              {einvBusy ? "Registering…" : "Generate IRN (e-invoice)"}
            </button>
          </>
        )}
      </section>

      <section className="panel invoice-sheet">
        <div className="invoice-title-row">
          <h2 className="invoice-title">Tax Invoice</h2>
          <span className="muted small">Original / Duplicate Bill</span>
        </div>

        <div className="invoice-top">
          <div className="invoice-brand">
            {data.company.logoDataUrl && (
              <img
                className="invoice-logo"
                src={data.company.logoDataUrl}
                alt=""
              />
            )}
            <div>
              <h2 style={{ margin: 0 }}>{data.company.name}</h2>
              {data.company.businessTagline && (
                <p className="muted small" style={{ margin: "0.15rem 0" }}>
                  {data.company.businessTagline}
                </p>
              )}
              {data.company.address
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line, i) => (
                  <p key={i} className="muted small" style={{ margin: "0.1rem 0" }}>
                    {line}
                  </p>
                ))}
              <p className="muted small" style={{ margin: "0.15rem 0" }}>
                {[data.company.phone, data.company.email, data.company.website]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="muted small" style={{ margin: "0.15rem 0" }}>
                {[
                  data.company.gstin ? `GSTIN ${data.company.gstin}` : "",
                  data.company.pan ? `PAN ${data.company.pan}` : "",
                  data.company.cin ? `CIN ${data.company.cin}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "Add letterhead under Companies"}
              </p>
            </div>
          </div>
          <div className="invoice-badge">TAX INVOICE</div>
        </div>

        <div className="invoice-meta-grid">
          <div>
            <p className="muted small">Bill To</p>
            <strong>{data.party.name}</strong>
            {data.party.address && (
              <p className="muted small pre-line">{data.party.address}</p>
            )}
            <p className="muted small">
              {data.party.stateCode
                ? stateLabel(data.party.stateCode)
                : "State —"}
            </p>
            <p className="muted small">
              {data.party.gstin ? `GSTIN ${data.party.gstin}` : "GSTIN —"}
            </p>
            {data.party.email && (
              <p className="muted small">{data.party.email}</p>
            )}
          </div>
          <div>
            <p className="muted small">Ship To</p>
            <strong>{shipName || "—"}</strong>
            {shipAddr && (
              <p className="muted small pre-line">{shipAddr}</p>
            )}
            <p className="muted small">
              {shipState ? stateLabel(shipState) : "State —"}
            </p>
            <p className="muted small">
              {shipGstin ? `GSTIN ${shipGstin}` : "GSTIN —"}
            </p>
          </div>
          <div>
            <p className="muted small">Invoice</p>
            <p>
              <strong>{data.number}</strong> · {data.date}
            </p>
            <p className="muted small">
              Payment: {data.paymentMode || "—"} · Reverse charge:{" "}
              {data.reverseCharge ? "YES" : "NO"}
            </p>
            <p className="muted small">
              Buyer order: {data.buyerOrderNo || "—"} · Supplier ref:{" "}
              {data.supplierRef || "—"}
            </p>
            <p className="muted small">
              Vehicle: {data.vehicleNo || "—"} · Delivery:{" "}
              {data.deliveryDate || "—"}
            </p>
            <p className="muted small">
              Transport: {data.transport || "—"} · Terms:{" "}
              {data.termsOfDelivery || "—"}
            </p>
            {data.ewbNo && (
              <p className="muted small">
                e-Way bill: {data.ewbNo}
                {data.ewbValidUpto ? ` · valid ${data.ewbValidUpto}` : ""}
              </p>
            )}
            {data.irn && (
              <p className="muted small">
                e-Invoice IRN: {data.irn.slice(0, 20)}…
                {data.irnStatus === "CNL" ? " (CANCELLED)" : ""}
              </p>
            )}
            <p className="muted small">
              Place of supply: {stateLabel(data.placeOfSupply)} ·{" "}
              {data.isInterstate ? "Inter-state" : "Intra-state"}
            </p>
          </div>
        </div>

        <table className="table invoice-lines" style={{ marginTop: "1rem" }}>
          <thead>
            <tr>
              <th>Sr</th>
              <th>Description</th>
              <th>HSN</th>
              <th className="num">Qty</th>
              <th className="num">Rate</th>
              <th className="num">Taxable</th>
              <th className="num">GST</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <div>{line.description}</div>
                  {line.lineDescription && (
                    <div className="muted small">{line.lineDescription}</div>
                  )}
                  {(line.batchNo || line.serialNo) && (
                    <div className="muted small">
                      {[
                        line.batchNo ? `Batch: ${line.batchNo}` : "",
                        line.serialNo ? `Serial: ${line.serialNo}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </td>
                <td>{line.hsnSac || "—"}</td>
                <td className="num">
                  {line.qty != null
                    ? `${line.qty}${line.unit ? ` ${line.unit}` : ""}`
                    : "—"}
                </td>
                <td className="num">
                  {line.rate != null ? formatInr(line.rate) : "—"}
                </td>
                <td className="num">{formatInr(line.taxable)}</td>
                <td className="num">
                  {line.gstRate}% / {formatInr(line.gstAmount)}
                </td>
                <td className="num">{formatInr(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3}>
                <strong>Sub-Total</strong>
              </td>
              <td className="num">{subQty || "—"}</td>
              <td />
              <td className="num">{formatInr(subTaxable)}</td>
              <td className="num">{formatInr(subGst)}</td>
              <td className="num">{formatInr(subTotal)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="invoice-bottom">
          <div>
            <p className="muted small">Our Bank Details</p>
            {data.company.bankName || data.company.upiId ? (
              <>
                {data.company.bankName && (
                  <p className="small">Bank: {data.company.bankName}</p>
                )}
                {data.company.bankBranch && (
                  <p className="small">Branch: {data.company.bankBranch}</p>
                )}
                {data.company.bankAccount && (
                  <p className="small">A/C No: {data.company.bankAccount}</p>
                )}
                {data.company.bankIfsc && (
                  <p className="small">IFSC: {data.company.bankIfsc}</p>
                )}
                {data.company.upiId && (
                  <p className="small">UPI: {data.company.upiId}</p>
                )}
              </>
            ) : (
              <p className="muted small">
                Add bank details under Companies → Invoice letterhead
              </p>
            )}
          </div>
          <div className="invoice-totals">
            <div className="list-row">
              <span>Taxable value</span>
              <span>{formatInr(data.taxableValue)}</span>
            </div>
            {data.isInterstate ? (
              <div className="list-row">
                <span>IGST @ {data.gstRate}%</span>
                <span>{formatInr(data.igst)}</span>
              </div>
            ) : (
              <>
                <div className="list-row">
                  <span>CGST @ {data.gstRate / 2}%</span>
                  <span>{formatInr(data.cgst)}</span>
                </div>
                <div className="list-row">
                  <span>SGST @ {data.gstRate / 2}%</span>
                  <span>{formatInr(data.sgst)}</span>
                </div>
              </>
            )}
            {data.freight !== 0 && (
              <div className="list-row">
                <span>Freight / packing</span>
                <span>{formatInr(data.freight)}</span>
              </div>
            )}
            {data.roundOff !== 0 && (
              <div className="list-row">
                <span>Round off</span>
                <span>{formatInr(data.roundOff)}</span>
              </div>
            )}
            <div className="list-row">
              <strong>Total Amount</strong>
              <strong>{formatInr(data.total)}</strong>
            </div>
          </div>
        </div>

        {data.irn && (
          <div
            style={{
              display: "flex",
              gap: "0.9rem",
              alignItems: "flex-start",
              marginTop: "1rem",
            }}
          >
            {irnQr && (
              <img
                src={irnQr}
                alt="e-Invoice QR"
                style={{ width: 86, height: 86 }}
              />
            )}
            <div className="small">
              <strong>
                e-Invoice{data.irnStatus === "CNL" ? " — CANCELLED" : ""}
              </strong>
              <p
                className="muted small"
                style={{ wordBreak: "break-all", margin: "0.2rem 0" }}
              >
                IRN: {data.irn}
              </p>
              <p className="muted small" style={{ margin: "0.2rem 0" }}>
                Ack No: {data.irnAckNo || "—"} · Ack Date:{" "}
                {data.irnAckDate || "—"}
                {data.irnStatus === "CNL"
                  ? ` · Cancelled: ${data.irnCancelDate || "—"}`
                  : ""}
              </p>
            </div>
          </div>
        )}

        <p className="small" style={{ marginTop: "1rem" }}>
          <strong>Amount in words:</strong> {data.amountInWords}
        </p>

        {(data.company.invoiceTerms || data.narration) && (
          <div style={{ marginTop: "1rem" }}>
            <p className="muted small">Declaration</p>
            {data.company.invoiceTerms && (
              <p className="small pre-line">{data.company.invoiceTerms}</p>
            )}
            {data.narration && (
              <p className="muted small">Narration: {data.narration}</p>
            )}
          </div>
        )}

        <div className="invoice-sign">
          <span className="muted small">E. &amp; O.E.</span>
          <div className="invoice-sign-block">
            <p>
              <strong>For, {data.company.name}</strong>
            </p>
            <p className="muted small" style={{ marginTop: "2rem" }}>
              Authorised Signatory
            </p>
          </div>
        </div>
        <p className="invoice-thanks">Thank You For Business With Us!</p>
      </section>
    </div>
  );
}
