import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  Fragment,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  getVoucherById,
  getVoucherLines,
  insertVoucher,
  listLedgers,
  updateVoucher,
  type LedgerRow,
} from "../lib/db/client";
import {
  getVoucherStockMovements,
  listGodowns,
  listStockItems,
  type GodownRow,
  type StockItemRow,
} from "../lib/db/inventory";
import { draftVoucher, draftVoucherFromBill } from "../lib/ai/client";
import { createMastersFromSeeds } from "../lib/ai/createMasters";
import { AI_EXAMPLE_SENTENCES } from "../lib/ai/examples";
import { fileToBillDataUrl } from "../lib/ai/image";
import { useSpeechInput } from "../lib/ai/useSpeech";
import { aiConfigured, getAiSettings } from "../lib/db/ai";
import type { ParsedDraft, SeedItem, SeedParty } from "../lib/ai/parse";
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
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const navigate = useNavigate();
  const [ledgers, setLedgers] = useState<LedgerRow[]>([]);
  const [editLock, setEditLock] = useState<string | null>(null);
  const [editLoaded, setEditLoaded] = useState(false);
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
  const [aiSentence, setAiSentence] = useState(() => params.get("ai") || "");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiWaitSecs, setAiWaitSecs] = useState(0);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [aiApplied, setAiApplied] = useState(false);
  const [partySeed, setPartySeed] = useState<SeedParty | null>(null);
  const [itemSeeds, setItemSeeds] = useState<SeedItem[]>([]);
  const [mastersBusy, setMastersBusy] = useState(false);
  const [billPreview, setBillPreview] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const billInputRef = useRef<HTMLInputElement>(null);
  const autoDrafted = useRef(false);
  const speech = useSpeechInput((t) => setAiSentence(t));

  useEffect(() => {
    if (!aiBusy) {
      setAiWaitSecs(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setAiWaitSecs(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [aiBusy]);

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

  // Edit mode: load the posted voucher (header + lines + stock) into the form.
  useEffect(() => {
    if (!company || !editId) return;
    void (async () => {
      try {
        const v = await getVoucherById(editId);
        if (!v) throw new Error("Voucher not found.");
        const t = v.voucher_type as VoucherTypeCode;
        setVoucherType(t);
        setDate(v.date);
        setNumber(v.number || "");
        setNarration(v.narration || "");
        if (v.irn && v.irn_status !== "CNL") {
          setEditLock(
            "This invoice has an active e-invoice IRN — cancel the IRN on the invoice page before editing.",
          );
        } else if (v.ewb_no) {
          setEditLock(
            `This invoice has e-way bill ${v.ewb_no} — cancel it on the NIC portal before editing.`,
          );
        }
        if (v.party_ledger_id) setPartyId(v.party_ledger_id);
        if (v.place_of_supply) setPlaceOfSupply(v.place_of_supply);
        if (v.hsn_sac) setHsn(v.hsn_sac);
        if (v.gst_rate != null) setGstRate(v.gst_rate);
        if (v.taxable_value != null) setTaxable(String(v.taxable_value));
        setPaymentMode(v.payment_mode || "");
        setReverseCharge(Boolean(v.reverse_charge));
        setBuyerOrderNo(v.buyer_order_no || "");
        setSupplierRef(v.supplier_ref || "");
        setVehicleNo(v.vehicle_no || "");
        setDeliveryDate(v.delivery_date || "");
        setTransport(v.transport || "");
        setTermsOfDelivery(v.terms_of_delivery || "");
        setShipToName(v.ship_to_name || "");
        setShipToAddress(v.ship_to_address || "");
        setShipToState(v.ship_to_state || "");
        setShipToGstin(v.ship_to_gstin || "");
        if (Number(v.freight_amount)) setFreightAmount(String(v.freight_amount));
        if (Number(v.round_off)) setRoundOff(String(v.round_off));
        setShowInvoiceExtras(
          Boolean(
            v.payment_mode ||
              v.buyer_order_no ||
              v.vehicle_no ||
              v.ship_to_name ||
              Number(v.freight_amount) ||
              Number(v.round_off),
          ),
        );

        const vl = await getVoucherLines(editId);
        if (!v.party_ledger_id && vl.length > 0) {
          setLines(
            vl.map((l) => ({
              ledgerId: l.ledger_id,
              debit: l.debit,
              credit: l.credit,
              narration: l.line_narration || undefined,
            })),
          );
        }

        const moves = await getVoucherStockMovements(editId);
        if (moves.length > 0) {
          setUseStock(true);
          setStockLines(
            moves.map((m) => ({
              itemId: m.item_id,
              godownId: m.godown_id,
              qty: String(
                t === "purchase" ? m.qty_in : m.qty_out,
              ),
              rate: String(m.rate),
              batchNo: m.batch_no || "",
              serialNo: m.serial_no || "",
              lineDescription: m.line_description || "",
            })),
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setEditLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, editId]);

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

    let nextGst: number | null = draft.gstRate;
    if (nextGst == null && draft.stockLines[0]?.itemId) {
      nextGst =
        stockItems.find((i) => i.id === draft.stockLines[0].itemId)?.gst_rate ??
        null;
    }
    if (nextGst != null) setGstRate(nextGst);

    if (draft.hsn) {
      setHsn(draft.hsn);
    } else if (draft.stockLines[0]?.itemId) {
      const item = stockItems.find((i) => i.id === draft.stockLines[0].itemId);
      if (item?.hsn_sac) setHsn(item.hsn_sac);
    }

    if (draft.stockLines.length > 0 && stockOk) {
      const defGodown: number | "" =
        godowns.find((g) => g.is_default)?.id || godowns[0]?.id || "";
      setUseStock(true);
      const mapped = draft.stockLines.map((line) => {
        const item = stockItems.find((i) => i.id === line.itemId);
        const fallbackRate =
          effectiveType === "purchase"
            ? item?.purchase_rate
            : item?.sales_rate;
        // Prefer AI rate, then derive from taxable÷qty, then item master rate.
        let rate = line.rate;
        if (rate == null && draft.taxable != null && (line.qty || 1) > 0) {
          rate =
            Math.round((draft.taxable / (line.qty || 1)) * 100) / 100;
        }
        if (rate == null) rate = fallbackRate ?? 0;
        return {
          itemId: (line.itemId ?? "") as number | "",
          godownId: defGodown,
          qty: String(line.qty ?? 1),
          rate: String(rate),
          batchNo: "",
          serialNo: "",
          lineDescription: line.description ?? "",
        };
      });
      setStockLines(mapped);
      // Keep taxable in sync so the GST panel isn't blank while stock is on.
      const stockTotal = mapped.reduce(
        (sum, l) => sum + (Number(l.qty) || 0) * (Number(l.rate) || 0),
        0,
      );
      if (stockTotal > 0) setTaxable(String(Math.round(stockTotal * 100) / 100));
      else if (draft.taxable != null) setTaxable(String(draft.taxable));
    } else if (draft.taxable != null) {
      setUseStock(false);
      setTaxable(String(draft.taxable));
    }
  }

  async function buildDraftContext() {
    return {
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
    };
  }

  function handleParsedDraft(parsed: ParsedDraft) {
    applyAiDraft(parsed);
    setAiWarnings(parsed.warnings);
    setAiApplied(true);
    const seeds = parsed.seedItems ?? [];
    setItemSeeds(seeds);
    if (parsed.seedParty) {
      setPartySeed(parsed.seedParty);
    } else {
      setPartySeed(null);
    }
    // Prefer one-click Create masters when anything is missing; skip auto-opening
    // the party form so the user isn't interrupted mid-review.
    if (!parsed.seedParty && seeds.length === 0) {
      /* nothing to create */
    }
  }

  async function onCreateMastersFromBill() {
    if (!partySeed && itemSeeds.length === 0) return;
    setMastersBusy(true);
    setError(null);
    try {
      const kind: "debtor" | "creditor" =
        voucherType === "purchase" ? "creditor" : "debtor";
      const result = await createMastersFromSeeds({
        party: partySeed,
        items: itemSeeds,
        kind,
        asPurchase: voucherType === "purchase",
      });
      const nextLedgers = await listLedgers();
      const nextItems = await listStockItems();
      setLedgers(nextLedgers);
      setStockItems(nextItems);

      if (result.partyId) {
        setPartyId(result.partyId);
        const party = nextLedgers.find((l) => l.id === result.partyId);
        if (party?.state_code) setPlaceOfSupply(party.state_code);
        else if (partySeed?.stateCode) setPlaceOfSupply(partySeed.stateCode);
      }
      if (result.itemIds.size > 0) {
        const defGodown: number | "" =
          godowns.find((g) => g.is_default)?.id || godowns[0]?.id || "";
        setUseStock(true);
        setStockLines((prev) => {
          // Fill empty item lines from seeds by description/name order.
          const pending = [...itemSeeds];
          return prev.map((row) => {
            if (row.itemId) return row;
            const seed =
              pending.find(
                (s) =>
                  s.name === row.lineDescription ||
                  s.name === row.lineDescription.trim(),
              ) || pending.shift();
            if (!seed) return row;
            const id = result.itemIds.get(seed.name.trim());
            if (!id) return row;
            const item = nextItems.find((i) => i.id === id);
            return {
              ...row,
              itemId: id,
              godownId: row.godownId || defGodown,
              rate:
                row.rate && Number(row.rate) > 0
                  ? row.rate
                  : String(
                      voucherType === "purchase"
                        ? item?.purchase_rate ?? seed.rate ?? 0
                        : item?.sales_rate ?? seed.rate ?? 0,
                    ),
              lineDescription: row.lineDescription || seed.name,
            };
          });
        });
        // Append any seeds that weren't represented as pending lines.
        setStockLines((prev) => {
          const covered = new Set(
            prev
              .filter((r) => r.itemId)
              .map((r) => Number(r.itemId)),
          );
          const extras = itemSeeds.filter((s) => {
            const id = result.itemIds.get(s.name.trim());
            return id != null && !covered.has(id);
          });
          if (extras.length === 0) return prev;
          return [
            ...prev,
            ...extras.map((s) => {
              const id = result.itemIds.get(s.name.trim())!;
              const item = nextItems.find((i) => i.id === id);
              return {
                itemId: id as number | "",
                godownId: defGodown,
                qty: String(s.qty ?? 1),
                rate: String(
                  voucherType === "purchase"
                    ? item?.purchase_rate ?? s.rate ?? 0
                    : item?.sales_rate ?? s.rate ?? 0,
                ),
                batchNo: "",
                serialNo: "",
                lineDescription: s.name,
              };
            }),
          ];
        });
      }

      const notes = [
        result.partyId ? `Created party “${partySeed?.name}”.` : null,
        result.itemIds.size
          ? `Created ${result.itemIds.size} stock item${result.itemIds.size === 1 ? "" : "s"}.`
          : null,
        ...result.warnings,
      ].filter(Boolean) as string[];
      if (notes.length) {
        setAiWarnings((prev) => [...notes, ...prev.filter((w) => !/create it from the bill/i.test(w) && !/No party matching|No stock item matching/i.test(w))]);
      }
      setPartySeed(null);
      setItemSeeds([]);
      setPartyForm("closed");
      setPlainPartyForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMastersBusy(false);
    }
  }

  async function onAiDraft() {
    if (!aiSentence.trim()) return;
    setAiBusy(true);
    setError(null);
    setAiWarnings([]);
    setAiApplied(false);
    try {
      const parsed = await draftVoucher(
        aiSentence.trim(),
        await buildDraftContext(),
      );
      handleParsedDraft(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function onBillCapture(file: File) {
    setAiBusy(true);
    setError(null);
    setAiWarnings([]);
    setAiApplied(false);
    setPartySeed(null);
    setItemSeeds([]);
    try {
      const dataUrl = await fileToBillDataUrl(file);
      setBillPreview(dataUrl);
      const parsed = await draftVoucherFromBill(
        dataUrl,
        await buildDraftContext(),
      );
      handleParsedDraft(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
      if (billInputRef.current) billInputRef.current.value = "";
    }
  }

  // Cmd-K palette handoff: /vouchers/new?ai=<sentence>&go=1 drafts on arrival.
  useEffect(() => {
    if (
      !editId &&
      aiReady &&
      params.get("go") === "1" &&
      aiSentence.trim() &&
      ledgers.length > 0 &&
      !autoDrafted.current
    ) {
      autoDrafted.current = true;
      void onAiDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId, aiReady, aiSentence, ledgers.length]);

  // A draft is only a proposal — bring the review form into view.
  useEffect(() => {
    if (aiApplied) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [aiApplied]);

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
        const payload = {
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
        };
        const voucherId = editId
          ? await updateVoucher(editId, payload).then(() => editId)
          : await insertVoucher(payload);
        if (voucherType === "sales") {
          navigate(`/vouchers/${voucherId}/invoice${editId ? "" : "?send=1"}`);
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
      const payload = {
        voucherType,
        date,
        number: number || undefined,
        narration: narration || undefined,
        totalAmount: result.totalDebit,
        lines: draft.lines,
      };
      if (editId) {
        await updateVoucher(editId, payload);
      } else {
        await insertVoucher(payload);
      }
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
          <h1>{editId ? `Edit voucher #${editId}` : "New voucher"}</h1>
          <p className="lede">
            {editId
              ? "Re-posts the voucher with your changes; lines and stock movements are replaced."
              : aiReady
                ? "Describe the transaction — Kite drafts it, you review and accept."
                : isGstVoucher
                  ? "GST invoice — tax splits auto-post to CGST/SGST or IGST."
                  : "Debits must equal credits before save."}
          </p>
        </div>
        <Link className="ghost btn" to="/vouchers">
          Back
        </Link>
      </header>

      {editLock && (
        <p className="error" role="alert">
          {editLock}
        </p>
      )}
      {editId && !editLoaded && !error && (
        <p className="muted">Loading voucher…</p>
      )}

      {!editId && aiReady && (
        <section className="panel ai-hero" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>Tell Kite what happened</h2>
          <p className="muted small">
            Type a sentence, dictate, or snap a purchase bill — the AI drafts
            the voucher for review. Nothing posts until you Accept.
          </p>
          <textarea
            rows={2}
            autoFocus
            value={aiSentence}
            onChange={(e) => setAiSentence(e.target.value)}
            placeholder="Sold 2 Wireless Mouse to Agarwal @799 on UPI"
            disabled={aiBusy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void onAiDraft();
              }
            }}
          />
          <div className="chip-row" style={{ margin: "0.5rem 0 0.75rem" }}>
            {AI_EXAMPLE_SENTENCES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="chip"
                disabled={aiBusy}
                onClick={() => setAiSentence(ex)}
              >
                {ex}
              </button>
            ))}
          </div>
          <input
            ref={billInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onBillCapture(f);
            }}
          />
          <div className="cta-row">
            <button
              type="button"
              className="secondary"
              disabled={aiBusy}
              onClick={() => billInputRef.current?.click()}
              title="Take a photo or upload a purchase bill"
            >
              Scan bill
            </button>
            {speech.supported && (
              <button
                type="button"
                className={speech.listening ? "secondary" : "ghost"}
                disabled={aiBusy}
                onClick={speech.toggle}
                title="Dictate in English or Hinglish"
              >
                {speech.listening ? "● Listening… tap to stop" : "Dictate"}
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={aiBusy || !aiSentence.trim()}
              onClick={() => void onAiDraft()}
            >
              {aiBusy
                ? `Drafting… ${aiWaitSecs}s`
                : "Draft voucher"}
            </button>
            <span className="muted small">
              {aiBusy
                ? billPreview
                  ? "Reading the bill — free vision models often take 20–60s"
                  : "Free models can take 15–40s — the window stays usable"
                : "or fill the form manually below"}
            </span>
          </div>
          {billPreview && (
            <div
              style={{
                marginTop: "0.75rem",
                display: "flex",
                gap: "0.75rem",
                alignItems: "flex-start",
              }}
            >
              <img
                src={billPreview}
                alt="Bill preview"
                style={{
                  width: 96,
                  height: 96,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid var(--line)",
                }}
              />
              <button
                type="button"
                className="ghost"
                disabled={aiBusy}
                onClick={() => setBillPreview(null)}
              >
                Clear photo
              </button>
            </div>
          )}
          {aiApplied && (
            <p className="notice">
              Draft applied — review the form and Accept voucher when it looks
              right.
            </p>
          )}
          {aiWarnings.length > 0 && (
            <div
              className="warn-text small"
              style={{
                marginTop: "0.5rem",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "0.5rem 0.7rem",
                background: "var(--warn-soft)",
              }}
            >
              <strong>Needs your attention:</strong>
              <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem" }}>
                {aiWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {(partySeed || itemSeeds.length > 0) && (
            <div
              className="notice small"
              style={{
                marginTop: "0.6rem",
                border: "1px solid var(--line)",
                borderRadius: 8,
                padding: "0.6rem 0.75rem",
              }}
            >
              <strong>New masters from this bill</strong>
              <ul style={{ margin: "0.35rem 0", paddingLeft: "1.1rem" }}>
                {partySeed && (
                  <li>
                    Party: {partySeed.name}
                    {partySeed.gstin ? ` · ${partySeed.gstin}` : ""}
                    {partySeed.stateCode ? ` · state ${partySeed.stateCode}` : ""}
                  </li>
                )}
                {itemSeeds.map((it) => (
                  <li key={it.name}>
                    Item: {it.name}
                    {it.hsn ? ` · HSN ${it.hsn}` : ""}
                    {it.rate != null ? ` · ₹${it.rate}` : ""}
                    {it.gstRate != null ? ` · ${it.gstRate}%` : ""}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="primary btn"
                disabled={mastersBusy || aiBusy}
                onClick={() => void onCreateMastersFromBill()}
              >
                {mastersBusy ? "Creating…" : "Create masters"}
              </button>
              <button
                type="button"
                className="ghost btn"
                style={{ marginLeft: "0.5rem" }}
                disabled={mastersBusy}
                onClick={() => {
                  if (partySeed) {
                    if (gstEnabled && (voucherType === "purchase" || voucherType === "sales")) {
                      setPartyForm("new");
                    } else {
                      setPlainPartyForm(true);
                    }
                  }
                }}
              >
                Edit manually
              </button>
            </div>
          )}
        </section>
      )}

      {!editId && !aiReady && (
        <p className="muted small" style={{ marginTop: 0 }}>
          Tip: set up AI quick entry under{" "}
          <Link to="/companies">Companies</Link> to draft vouchers from a
          sentence — a free OpenRouter key works, no card needed. Or fill the
          form manually below.
        </p>
      )}

      <form className="panel" onSubmit={onSubmit} ref={formRef}>
        <div className="form-row">
          <label>
            Type
            <select
              value={voucherType}
              disabled={Boolean(editId)}
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
                seed={partyForm === "new" ? partySeed || undefined : undefined}
                onSaved={async (ledger) => {
                  setLedgers(await listLedgers());
                  setPartyId(ledger.id);
                  setPartyForm("closed");
                  setPartySeed(null);
                }}
                onCancel={() => {
                  setPartyForm("closed");
                  setPartySeed(null);
                }}
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
                  voucherType === "payment" || voucherType === "purchase"
                    ? "creditor"
                    : "debtor"
                }
                seed={partySeed || undefined}
                onSaved={async (ledger) => {
                  setLedgers(await listLedgers());
                  setPartyId(ledger.id);
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
                  setPartySeed(null);
                }}
                onCancel={() => {
                  setPlainPartyForm(false);
                  setPartySeed(null);
                }}
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
          <button
            className="primary"
            type="submit"
            disabled={busy || Boolean(editLock) || Boolean(editId && !editLoaded)}
          >
            {busy
              ? "Saving…"
              : editId
                ? "Save changes"
                : "Accept voucher"}
          </button>
        </div>
      </form>
    </div>
  );
}
