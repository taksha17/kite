import { useEffect, useMemo, useState, type FormEvent, Fragment } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { formatInr, sumLines, validateVoucher } from "../lib/accounting/engine";
import {
  buildGstAccountingLines,
  computeGst,
  GST_RATES,
  INDIA_STATES,
} from "../lib/accounting/gst";
import type { DraftLine, VoucherTypeCode } from "../lib/accounting/types";
import {
  lineAmount,
  sumItemAmounts,
} from "../lib/inventory/calc";
import {
  findLedgerByName,
  insertVoucher,
  listLedgers,
  type LedgerRow,
} from "../lib/db/client";
import {
  listGodowns,
  listStockItems,
  type GodownRow,
  type StockItemRow,
} from "../lib/db/inventory";
import { draftVoucher } from "../lib/ai/client";
import { aiConfigured, getAiSettings } from "../lib/db/ai";
import type { ParsedDraft } from "../lib/ai/parse";
import { InlineItemForm, InlinePartyForm } from "../components/InlineMasters";
import { useApp } from "../state/AppContext";

const TYPES: { code: VoucherTypeCode; label: string }[] = [
  { code: "payment", label: "Payment" },
  { code: "receipt", label: "Receipt" },
  { code: "contra", label: "Contra" },
  { code: "journal", label: "Journal" },
  { code: "sales", label: "Sales" },
  { code: "purchase", label: "Purchase" },
];

function emptyLine(): DraftLine {
  return { ledgerId: 0, debit: 0, credit: 0 };
}

type StockDraft = {
  itemId: number | "";
  godownId: number | "";
  qty: string;
  rate: string;
  batchNo: string;
  serialNo: string;
  lineDescription: string;
};

function emptyStock(godownId: number | "" = ""): StockDraft {
  return {
    itemId: "",
    godownId,
    qty: "1",
    rate: "0",
    batchNo: "",
    serialNo: "",
    lineDescription: "",
  };
}

export function VoucherEditorPage() {
  const { company, allowed } = useApp();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [voucherType, setVoucherType] = useState<VoucherTypeCode>(
    (params.get("type") as VoucherTypeCode) || "journal",
  );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [number, setNumber] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const gstEnabled = Boolean(company?.gst_enabled);
  const isGstVoucher =
    gstEnabled && (voucherType === "sales" || voucherType === "purchase");

  const [partyId, setPartyId] = useState<number | "">("");
  const [placeOfSupply, setPlaceOfSupply] = useState(company?.state_code || "29");
  const [hsn, setHsn] = useState("");
  const [gstRate, setGstRate] = useState<number>(18);
  const [taxable, setTaxable] = useState("");
  const [stockItems, setStockItems] = useState<StockItemRow[]>([]);
  const [godowns, setGodowns] = useState<GodownRow[]>([]);
  const [useStock, setUseStock] = useState(false);
  const [stockLines, setStockLines] = useState<StockDraft[]>([emptyStock()]);

  // Inline master create/edit (party / stock item) without leaving the form.
  const [partyForm, setPartyForm] = useState<"closed" | "new" | "edit">(
    "closed",
  );
  const [plainPartyForm, setPlainPartyForm] = useState(false);
  const [itemForm, setItemForm] = useState<{
    index: number;
    mode: "new" | "edit";
  } | null>(null);

  const [paymentMode, setPaymentMode] = useState("");
  const [reverseCharge, setReverseCharge] = useState(false);
  const [buyerOrderNo, setBuyerOrderNo] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [vehicleNo, setVehicleNo] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [transport, setTransport] = useState("");
  const [termsOfDelivery, setTermsOfDelivery] = useState("");
  const [shipToName, setShipToName] = useState("");
  const [shipToAddress, setShipToAddress] = useState("");
  const [shipToState, setShipToState] = useState("");
  const [shipToGstin, setShipToGstin] = useState("");
  const [freightAmount, setFreightAmount] = useState("");
  const [roundOff, setRoundOff] = useState("");
  const [showInvoiceExtras, setShowInvoiceExtras] = useState(false);

  const [aiReady, setAiReady] = useState(false);
  const [aiSentence, setAiSentence] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiApplied, setAiApplied] = useState(false);

  const canHaveStock = voucherType === "sales" || voucherType === "purchase";

  useEffect(() => {
    if (company) {
      void listLedgers().then(setLedgers);
      void listStockItems().then(setStockItems);
      void listGodowns().then((g) => {
        setGodowns(g);
        const def = g.find((x) => x.is_default)?.id || g[0]?.id || "";
        setStockLines((prev) =>
          prev.map((line) => ({ ...line, godownId: line.godownId || def })),
        );
      });
      if (company.state_code) setPlaceOfSupply(company.state_code);
      void getAiSettings().then((s) => setAiReady(aiConfigured(s)));
    }
  }, [company]);

  useEffect(() => {
    const party = ledgers.find((l) => l.id === Number(partyId));
    if (party?.state_code) setPlaceOfSupply(party.state_code);
  }, [partyId, ledgers]);

  const parties = useMemo(() => {
    if (voucherType === "sales") {
      return ledgers.filter(
        (l) => l.is_party || l.group_name === "Sundry Debtors",
      );
    }
    return ledgers.filter(
      (l) => l.is_party || l.group_name === "Sundry Creditors",
    );
  }, [ledgers, voucherType]);

  const usableStock = useMemo(
    () =>
      stockLines
        .filter((l) => l.itemId && l.godownId && Number(l.qty) > 0)
        .map((l) => ({
          itemId: Number(l.itemId),
          godownId: Number(l.godownId),
          qty: Number(l.qty) || 0,
          rate: Number(l.rate) || 0,
          batchNo: l.batchNo || undefined,
          serialNo: l.serialNo || undefined,
          lineDescription: l.lineDescription || undefined,
        })),
    [stockLines],
  );

  const stockTaxable = useMemo(
    () => (useStock && canHaveStock ? sumItemAmounts(usableStock) : 0),
    [useStock, canHaveStock, usableStock],
  );

  const effectiveTaxable =
    useStock && canHaveStock && stockTaxable > 0
      ? stockTaxable
      : Number(taxable) || 0;

  const gstBreakdown = useMemo(() => {
    if (!isGstVoucher) return null;
    return computeGst({
      taxableValue: effectiveTaxable,
      rate: gstRate,
      companyState: company?.state_code,
      placeOfSupply,
    });
  }, [
    isGstVoucher,
    effectiveTaxable,
    gstRate,
    company?.state_code,
    placeOfSupply,
  ]);

  const totals = useMemo(
    () => sumLines({ voucherType, date, lines }),
    [voucherType, date, lines],
  );

  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  function applyAiDraft(parsed: ParsedDraft) {
    const { draft } = parsed;
    const effectiveType = draft.voucherType ?? voucherType;
    const stockOk = effectiveType === "sales" || effectiveType === "purchase";

    if (draft.voucherType) setVoucherType(draft.voucherType);
    if (draft.date) setDate(draft.date);
    if (draft.number) setNumber(draft.number);
    if (draft.narration) setNarration(draft.narration);
    if (draft.paymentMode) {
      setPaymentMode(draft.paymentMode);
      setShowInvoiceExtras(true);
    }
    if (draft.partyId) setPartyId(draft.partyId);
    if (draft.placeOfSupply) setPlaceOfSupply(draft.placeOfSupply);
    if (draft.gstRate != null) {
      setGstRate(draft.gstRate);
    } else if (draft.stockLines[0]?.itemId) {
      const item = stockItems.find((i) => i.id === draft.stockLines[0].itemId);
      if (item) setGstRate(item.gst_rate);
    }
    if (draft.hsn) {
      setHsn(draft.hsn);
    } else if (draft.stockLines[0]?.itemId) {
      const item = stockItems.find((i) => i.id === draft.stockLines[0].itemId);
      if (item?.hsn_sac) setHsn(item.hsn_sac);
    }

    if (draft.stockLines.length > 0 && stockOk) {
      const defGodown =
        godowns.find((g) => g.is_default)?.id || godowns[0]?.id || "";
      setUseStock(true);
      setStockLines(
        draft.stockLines.map((line) => {
          const item = stockItems.find((i) => i.id === line.itemId);
          const fallbackRate =
            effectiveType === "purchase"
              ? item?.purchase_rate
              : item?.sales_rate;
          return {
            itemId: line.itemId ?? "",
            godownId: defGodown,
            qty: String(line.qty ?? 1),
            rate: String(line.rate ?? fallbackRate ?? 0),
            batchNo: "",
            serialNo: "",
            lineDescription: line.description ?? "",
          };
        }),
      );
    } else if (draft.taxable != null) {
      setTaxable(String(draft.taxable));
    }
  }

  async function onAiDraft() {
    if (!aiSentence.trim()) return;
    setAiBusy(true);
    setError(null);
    setAiWarnings([]);
    setAiApplied(false);
    try {
      const parsed = await draftVoucher(aiSentence.trim(), {
        today: date,
        companyStateCode: company?.state_code || "29",
        gstEnabled,
        parties: ledgers
          .filter(
            (l) =>
              l.is_party ||
              l.group_name === "Sundry Debtors" ||
              l.group_name === "Sundry Creditors",
          )
          .map((l) => ({ id: l.id, name: l.name, gstin: l.gstin })),
        items: stockItems.map((i) => ({
          id: i.id,
          name: i.name,
          salesRate: i.sales_rate,
          purchaseRate: i.purchase_rate,
          gstRate: i.gst_rate,
          hsn: i.hsn_sac,
        })),
      });
      applyAiDraft(parsed);
      setAiWarnings(parsed.warnings);
      setAiApplied(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      if (isGstVoucher) {
        if (!partyId) throw new Error("Select a party.");
        if (!gstBreakdown || gstBreakdown.taxableValue <= 0) {
          throw new Error("Enter a taxable value greater than zero.");
        }

        const incomeExpenseName =
          voucherType === "sales" ? "Sales" : "Purchase";
        const incomeExpense = await findLedgerByName(incomeExpenseName);
        const cgst = await findLedgerByName("CGST");
        const sgst = await findLedgerByName("SGST");
        const igst = await findLedgerByName("IGST");
        if (!incomeExpense || !cgst || !sgst || !igst) {
          throw new Error(
            "Missing Sales/Purchase or GST ledgers. Recreate company or add CGST/SGST/IGST.",
          );
        }

        const gstLines = buildGstAccountingLines({
          voucherType,
          partyLedgerId: Number(partyId),
          incomeExpenseLedgerId: incomeExpense.id,
          cgstLedgerId: cgst.id,
          sgstLedgerId: sgst.id,
          igstLedgerId: igst.id,
          breakdown: gstBreakdown,
        });

        const draft = {
          voucherType,
          date,
          number,
          narration,
          lines: gstLines,
        };
        const result = validateVoucher(draft);
        if (!result.ok) throw new Error(result.error);

        setBusy(true);
        const voucherId = await insertVoucher({
          voucherType,
          date,
          number: number || undefined,
          narration: narration || undefined,
          totalAmount: result.totalDebit,
          lines: gstLines,
          gst: {
            partyLedgerId: Number(partyId),
            placeOfSupply,
            isInterstate: gstBreakdown.isInterstate,
            hsnSac: hsn || undefined,
            gstRate,
            breakdown: gstBreakdown,
          },
          stockItems: useStock ? usableStock : undefined,
          invoiceExtras:
            voucherType === "sales"
              ? {
                  paymentMode,
                  reverseCharge,
                  buyerOrderNo,
                  supplierRef,
                  vehicleNo,
                  deliveryDate,
                  transport,
                  termsOfDelivery,
                  shipToName,
                  shipToAddress,
                  shipToState,
                  shipToGstin,
                  freightAmount: Number(freightAmount) || 0,
                  roundOff: Number(roundOff) || 0,
                }
              : undefined,
        });
        if (voucherType === "sales") {
          navigate(`/vouchers/${voucherId}/invoice?send=1`);
        } else {
          navigate("/vouchers");
        }
        return;
      }

      const draft = {
        voucherType,
        date,
        number,
        narration,
        lines: lines.filter((l) => l.ledgerId && (l.debit || l.credit)),
      };
      const result = validateVoucher(draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBusy(true);
      await insertVoucher({
        voucherType,
        date,
        number: number || undefined,
        narration: narration || undefined,
        totalAmount: result.totalDebit,
        lines: draft.lines,
      });
      navigate("/vouchers");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

  if (!allowed("create_voucher")) {
    return (
      <div className="page">
        <p className="muted">You do not have permission to post vouchers.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>New voucher</h1>
          <p className="lede">
            {isGstVoucher
              ? "GST invoice — tax splits auto-post to CGST/SGST or IGST."
              : "Debits must equal credits before save."}
          </p>
        </div>
        <Link className="ghost btn" to="/vouchers">
          Back
        </Link>
      </header>

      {aiReady && (
        <section className="panel" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>AI quick entry</h2>
          <p className="muted small">
            Describe the voucher in one sentence. The AI drafts it into the
            form below for your review — nothing posts until you press Accept
            voucher.
          </p>
          <div className="form-row" style={{ alignItems: "end" }}>
            <label style={{ flex: 1 }}>
              Sentence
              <input
                value={aiSentence}
                onChange={(e) => setAiSentence(e.target.value)}
                placeholder="Sold 2 Wireless Mouse to Agarwal @799 on UPI"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onAiDraft();
                  }
                }}
              />
            </label>
            <button
              type="button"
              className="secondary"
              disabled={aiBusy || !aiSentence.trim()}
              onClick={() => void onAiDraft()}
            >
              {aiBusy ? "Drafting…" : "Draft with AI"}
            </button>
          </div>
          {aiApplied && (
            <p className="notice">
              Draft applied — review the form and Accept voucher when it looks
              right.
            </p>
          )}
          {aiWarnings.length > 0 && (
            <ul className="muted small" style={{ marginBottom: 0 }}>
              {aiWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <form className="panel" onSubmit={onSubmit}>
        <div className="form-row">
          <label>
            Type
            <select
              value={voucherType}
              onChange={(e) =>
                setVoucherType(e.target.value as VoucherTypeCode)
              }
            >
              {TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </label>
          <label>
            Number
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        {isGstVoucher ? (
          <>
            <div className="form-row">
              <div>
                <label>
                  Party
                  <select
                    value={partyId}
                    onChange={(e) =>
                      setPartyId(e.target.value ? Number(e.target.value) : "")
                    }
                    required
                  >
                    <option value="">Select party</option>
                    {parties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.gstin ? ` (${p.gstin})` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="cta-row" style={{ marginTop: "0.25rem" }}>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setPartyForm("new")}
                  >
                    + New party
                  </button>
                  {partyId && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setPartyForm("edit")}
                    >
                      Edit party
                    </button>
                  )}
                </div>
              </div>
              <label>
                Place of supply
                <select
                  value={placeOfSupply}
                  onChange={(e) => setPlaceOfSupply(e.target.value)}
                >
                  {INDIA_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                HSN / SAC
                <input
                  value={hsn}
                  onChange={(e) => setHsn(e.target.value)}
                  placeholder="e.g. 998314"
                />
              </label>
            </div>

            {partyForm !== "closed" && (
              <InlinePartyForm
                defaultKind={voucherType === "sales" ? "debtor" : "creditor"}
                initial={
                  partyForm === "edit"
                    ? ledgers.find((l) => l.id === Number(partyId))
                    : undefined
                }
                onSaved={async (ledger) => {
                  setLedgers(await listLedgers());
                  setPartyId(ledger.id);
                  setPartyForm("closed");
                }}
                onCancel={() => setPartyForm("closed")}
              />
            )}
            <div className="form-row">
              <label>
                Taxable value (₹)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    useStock && stockTaxable > 0
                      ? String(stockTaxable)
                      : taxable
                  }
                  onChange={(e) => setTaxable(e.target.value)}
                  required={!useStock}
                  readOnly={useStock && stockTaxable > 0}
                />
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

            {canHaveStock && (
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={useStock}
                  onChange={(e) => setUseStock(e.target.checked)}
                />
                Include stock items (updates inventory)
              </label>
            )}

            {useStock && canHaveStock && (
              <div style={{ marginTop: "0.75rem" }}>
                <table className="table voucher-lines">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Godown</th>
                      <th className="num">Qty</th>
                      <th className="num">Rate</th>
                      <th className="num">Amount</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {stockLines.map((line, index) => {
                      const amt = lineAmount(Number(line.qty) || 0, Number(line.rate) || 0);
                      return (
                        <Fragment key={index}>
                        <tr>
                          <td>
                            <select
                              value={line.itemId}
                              onChange={(e) => {
                                const id = e.target.value
                                  ? Number(e.target.value)
                                  : "";
                                const item = stockItems.find((i) => i.id === id);
                                setStockLines((prev) =>
                                  prev.map((row, i) =>
                                    i === index
                                      ? {
                                          ...row,
                                          itemId: id,
                                          rate: item
                                            ? String(
                                                voucherType === "sales"
                                                  ? item.sales_rate
                                                  : item.purchase_rate,
                                              )
                                            : row.rate,
                                        }
                                      : row,
                                  ),
                                );
                                if (item?.hsn_sac) setHsn(item.hsn_sac);
                                if (item?.gst_rate != null) setGstRate(item.gst_rate);
                              }}
                            >
                              <option value="">Select item</option>
                              {stockItems.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                            <div
                              className="cta-row"
                              style={{ marginTop: "0.25rem" }}
                            >
                              <button
                                type="button"
                                className="ghost"
                                onClick={() =>
                                  setItemForm({ index, mode: "new" })
                                }
                              >
                                + New
                              </button>
                              {line.itemId && (
                                <button
                                  type="button"
                                  className="ghost"
                                  onClick={() =>
                                    setItemForm({ index, mode: "edit" })
                                  }
                                >
                                  Edit
                                </button>
                              )}
                            </div>
                          </td>
                          <td>
                            <select
                              value={line.godownId}
                              onChange={(e) =>
                                setStockLines((prev) =>
                                  prev.map((row, i) =>
                                    i === index
                                      ? {
                                          ...row,
                                          godownId: e.target.value
                                            ? Number(e.target.value)
                                            : "",
                                        }
                                      : row,
                                  ),
                                )
                              }
                            >
                              {godowns.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="num-input"
                              type="number"
                              min="0"
                              step="0.001"
                              value={line.qty}
                              onChange={(e) =>
                                setStockLines((prev) =>
                                  prev.map((row, i) =>
                                    i === index
                                      ? { ...row, qty: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td>
                            <input
                              className="num-input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.rate}
                              onChange={(e) =>
                                setStockLines((prev) =>
                                  prev.map((row, i) =>
                                    i === index
                                      ? { ...row, rate: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="num">{formatInr(amt)}</td>
                          <td>
                            <button
                              type="button"
                              className="ghost"
                              onClick={() =>
                                setStockLines((prev) =>
                                  prev.filter((_, i) => i !== index),
                                )
                              }
                              disabled={stockLines.length <= 1}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                        {voucherType === "sales" && (
                          <tr>
                            <td colSpan={6}>
                              <div className="form-row" style={{ margin: 0 }}>
                                <label>
                                  Description / notes
                                  <input
                                    value={line.lineDescription}
                                    onChange={(e) =>
                                      setStockLines((prev) =>
                                        prev.map((row, i) =>
                                          i === index
                                            ? {
                                                ...row,
                                                lineDescription: e.target.value,
                                              }
                                            : row,
                                        ),
                                      )
                                    }
                                    placeholder="Prints under item name"
                                  />
                                </label>
                                <label>
                                  Batch no.
                                  <input
                                    value={line.batchNo}
                                    onChange={(e) =>
                                      setStockLines((prev) =>
                                        prev.map((row, i) =>
                                          i === index
                                            ? { ...row, batchNo: e.target.value }
                                            : row,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  Serial no.
                                  <input
                                    value={line.serialNo}
                                    onChange={(e) =>
                                      setStockLines((prev) =>
                                        prev.map((row, i) =>
                                          i === index
                                            ? {
                                                ...row,
                                                serialNo: e.target.value,
                                              }
                                            : row,
                                        ),
                                      )
                                    }
                                  />
                                </label>
                              </div>
                            </td>
                            <td />
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <button
                  type="button"
                  className="secondary"
                  style={{ marginTop: "0.5rem" }}
                  onClick={() =>
                    setStockLines((prev) => [
                      ...prev,
                      emptyStock(godowns[0]?.id || ""),
                    ])
                  }
                >
                  Add item line
                </button>
                {stockItems.length === 0 && !itemForm && (
                  <p className="muted small">
                    No items yet — use “+ New” on an item line to create one.
                  </p>
                )}
                {itemForm && (
                  <InlineItemForm
                    initial={
                      itemForm.mode === "edit"
                        ? stockItems.find(
                            (i) =>
                              i.id ===
                              Number(stockLines[itemForm.index]?.itemId),
                          )
                        : undefined
                    }
                    onSaved={async (item) => {
                      const { index, mode } = itemForm;
                      setStockItems(await listStockItems());
                      setItemForm(null);
                      if (mode === "new") {
                        setStockLines((prev) =>
                          prev.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  itemId: item.id,
                                  rate: String(
                                    voucherType === "sales"
                                      ? item.sales_rate
                                      : item.purchase_rate,
                                  ),
                                }
                              : row,
                          ),
                        );
                        if (item.hsn_sac) setHsn(item.hsn_sac);
                        if (item.gst_rate != null) setGstRate(item.gst_rate);
                      }
                    }}
                    onCancel={() => setItemForm(null)}
                  />
                )}
              </div>
            )}

            {gstBreakdown && (
              <div className="stat-row gst-break">
                <div className="stat">
                  <p className="muted small">Supply</p>
                  <p className="stat-value" style={{ fontSize: "1.2rem" }}>
                    {gstBreakdown.isInterstate ? "Inter-state (IGST)" : "Intra-state"}
                  </p>
                </div>
                <div className="stat">
                  <p className="muted small">Tax</p>
                  <p className="stat-value" style={{ fontSize: "1.2rem" }}>
                    {gstBreakdown.isInterstate
                      ? `IGST ${formatInr(gstBreakdown.igst)}`
                      : `CGST ${formatInr(gstBreakdown.cgst)} + SGST ${formatInr(gstBreakdown.sgst)}`}
                  </p>
                </div>
                <div className="stat">
                  <p className="muted small">Invoice total</p>
                  <p className="stat-value" style={{ fontSize: "1.2rem" }}>
                    {formatInr(
                      gstBreakdown.invoiceTotal +
                        (voucherType === "sales"
                          ? (Number(freightAmount) || 0) +
                            (Number(roundOff) || 0)
                          : 0),
                    )}
                  </p>
                </div>
              </div>
            )}

            {voucherType === "sales" && (
              <div style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowInvoiceExtras((v) => !v)}
                >
                  {showInvoiceExtras ? "Hide" : "Show"} invoice details (Ship
                  To, payment, freight…)
                </button>
                {showInvoiceExtras && (
                  <div className="form" style={{ marginTop: "0.75rem" }}>
                    <div className="form-row">
                      <label>
                        Payment mode
                        <input
                          value={paymentMode}
                          onChange={(e) => setPaymentMode(e.target.value)}
                          placeholder="UPI / Cash / NEFT"
                        />
                      </label>
                      <label className="check-row" style={{ alignSelf: "end" }}>
                        <input
                          type="checkbox"
                          checked={reverseCharge}
                          onChange={(e) => setReverseCharge(e.target.checked)}
                        />
                        Reverse charge
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        Buyer’s order no.
                        <input
                          value={buyerOrderNo}
                          onChange={(e) => setBuyerOrderNo(e.target.value)}
                        />
                      </label>
                      <label>
                        Supplier’s ref.
                        <input
                          value={supplierRef}
                          onChange={(e) => setSupplierRef(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        Vehicle no.
                        <input
                          value={vehicleNo}
                          onChange={(e) => setVehicleNo(e.target.value)}
                        />
                      </label>
                      <label>
                        Delivery date
                        <input
                          type="date"
                          value={deliveryDate}
                          onChange={(e) => setDeliveryDate(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="form-row">
                      <label>
                        Transport
                        <input
                          value={transport}
                          onChange={(e) => setTransport(e.target.value)}
                        />
                      </label>
                      <label>
                        Terms of delivery
                        <input
                          value={termsOfDelivery}
                          onChange={(e) => setTermsOfDelivery(e.target.value)}
                        />
                      </label>
                    </div>
                    <h3 style={{ margin: "0.25rem 0", fontSize: "1rem" }}>
                      Ship To
                    </h3>
                    <div className="form-row">
                      <label>
                        Name
                        <input
                          value={shipToName}
                          onChange={(e) => setShipToName(e.target.value)}
                        />
                      </label>
                      <label>
                        GSTIN
                        <input
                          value={shipToGstin}
                          onChange={(e) =>
                            setShipToGstin(e.target.value.toUpperCase())
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Address
                      <textarea
                        value={shipToAddress}
                        onChange={(e) => setShipToAddress(e.target.value)}
                        rows={2}
                      />
                    </label>
                    <label>
                      State
                      <select
                        value={shipToState}
                        onChange={(e) => setShipToState(e.target.value)}
                      >
                        <option value="">—</option>
                        {INDIA_STATES.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.code} — {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-row">
                      <label>
                        Freight / packing (₹)
                        <input
                          type="number"
                          step="0.01"
                          value={freightAmount}
                          onChange={(e) => setFreightAmount(e.target.value)}
                        />
                      </label>
                      <label>
                        Round off (₹)
                        <input
                          type="number"
                          step="0.01"
                          value={roundOff}
                          onChange={(e) => setRoundOff(e.target.value)}
                        />
                      </label>
                    </div>
                    <p className="muted small">
                      Freight and round-off print on the invoice total; they do
                      not change the posted books total in this release.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <table className="table voucher-lines">
            <thead>
              <tr>
                <th>Ledger</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <select
                      value={line.ledgerId || ""}
                      onChange={(e) =>
                        updateLine(index, { ledgerId: Number(e.target.value) })
                      }
                    >
                      <option value="">Select ledger</option>
                      {ledgers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="num-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.debit || ""}
                      onChange={(e) =>
                        updateLine(index, {
                          debit: Number(e.target.value) || 0,
                          credit: 0,
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="num-input"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.credit || ""}
                      onChange={(e) =>
                        updateLine(index, {
                          credit: Number(e.target.value) || 0,
                          debit: 0,
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        setLines((prev) => prev.filter((_, i) => i !== index))
                      }
                      disabled={lines.length <= 2}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setLines((prev) => [...prev, emptyLine()])}
                  >
                    Add line
                  </button>
                </td>
                <td className="num">
                  <strong>{formatInr(totals.totalDebit)}</strong>
                </td>
                <td className="num">
                  <strong>{formatInr(totals.totalCredit)}</strong>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        {!isGstVoucher && (
          <div style={{ marginTop: "0.5rem" }}>
            <button
              type="button"
              className="ghost"
              onClick={() => setPlainPartyForm(true)}
            >
              + New party
            </button>
            {plainPartyForm && (
              <InlinePartyForm
                defaultKind={
                  voucherType === "payment" ? "creditor" : "debtor"
                }
                onSaved={async (ledger) => {
                  setLedgers(await listLedgers());
                  setLines((prev) => {
                    const idx = prev.findIndex((l) => !l.ledgerId);
                    if (idx === -1) {
                      return [
                        ...prev,
                        { ledgerId: ledger.id, debit: 0, credit: 0 },
                      ];
                    }
                    return prev.map((l, i) =>
                      i === idx ? { ...l, ledgerId: ledger.id } : l,
                    );
                  });
                  setPlainPartyForm(false);
                }}
                onCancel={() => setPlainPartyForm(false)}
              />
            )}
          </div>
        )}

        <label>
          Narration
          <input
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Optional note"
          />
        </label>

        {!gstEnabled &&
          (voucherType === "sales" || voucherType === "purchase") && (
            <p className="muted small">
              Tip: enable GST under{" "}
              <Link to="/companies">Companies</Link> for automatic tax vouchers.
            </p>
          )}

        {error && <p className="error">{error}</p>}

        <div className="cta-row" style={{ marginTop: "1rem" }}>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Accept voucher"}
          </button>
        </div>
      </form>
    </div>
  );
}
