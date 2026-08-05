import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { jsPDF } from "jspdf";
import { INDIA_STATES } from "../accounting/gst";
import type { SalesInvoiceData } from "./types";

function stateName(code: string): string {
  const hit = INDIA_STATES.find((s) => s.code === code);
  return hit ? `${code} — ${hit.name}` : code || "—";
}

function money(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export function invoiceFileName(data: SalesInvoiceData): string {
  const raw = `invoice-${data.number || data.voucherId}-${data.date}.pdf`;
  return raw.replace(/[^\w.\-]+/g, "_");
}

function logoFormat(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
  if (dataUrl.includes("image/jpeg") || dataUrl.includes("image/jpg")) {
    return "JPEG";
  }
  if (dataUrl.includes("image/webp")) return "WEBP";
  return "PNG";
}

function wrapText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineH = 11,
): number {
  if (!text) return y;
  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (const line of lines) {
    doc.text(line, x, y);
    y += lineH;
  }
  return y;
}

export function buildSalesInvoicePdf(data: SalesInvoiceData): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 36;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const innerW = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (need: number) => {
    if (y + need > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("TAX INVOICE", pageWidth / 2, y, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Original / Duplicate Bill", pageWidth - margin, y, {
    align: "right",
  });
  y += 18;

  let textX = margin;
  if (data.company.logoDataUrl) {
    try {
      const fmt = logoFormat(data.company.logoDataUrl);
      doc.addImage(data.company.logoDataUrl, fmt, margin, y - 2, 44, 44);
      textX = margin + 52;
    } catch {
      textX = margin;
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(data.company.name || "Company", textX, y + 10);
  y += 24;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  if (data.company.businessTagline) {
    doc.text(data.company.businessTagline, textX > margin ? textX : margin, y);
    y += 11;
  }
  const headerBits = [
    ...data.company.address
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
    data.company.phone ? `Contact: ${data.company.phone}` : "",
    data.company.email ? `Email: ${data.company.email}` : "",
    data.company.website ? `Web: ${data.company.website}` : "",
    [
      data.company.gstin ? `GSTIN: ${data.company.gstin}` : "",
      data.company.pan ? `PAN: ${data.company.pan}` : "",
      data.company.cin ? `CIN: ${data.company.cin}` : "",
    ]
      .filter(Boolean)
      .join("  |  "),
  ].filter(Boolean);
  for (const line of headerBits) {
    doc.text(line, margin, y);
    y += 10;
  }
  y = Math.max(y, margin + 70) + 6;
  doc.setDrawColor(40, 90, 140);
  doc.setLineWidth(1);
  doc.line(margin, y, pageWidth - margin, y);
  y += 12;

  // Three columns: Bill To | Ship To | Meta
  const colW = innerW / 3;
  const col1 = margin;
  const col2 = margin + colW;
  const col3 = margin + colW * 2;
  const topY = y;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Bill To", col1, y);
  doc.text("Ship To", col2, y);
  doc.text("Invoice", col3, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  let y1 = y;
  y1 = wrapText(doc, data.party.name || "—", col1, y1, colW - 8, 10);
  y1 = wrapText(doc, data.party.address || "", col1, y1, colW - 8, 10);
  y1 = wrapText(
    doc,
    data.party.stateCode ? `State: ${stateName(data.party.stateCode)}` : "",
    col1,
    y1,
    colW - 8,
    10,
  );
  y1 = wrapText(
    doc,
    data.party.gstin ? `GSTIN: ${data.party.gstin}` : "GSTIN: —",
    col1,
    y1,
    colW - 8,
    10,
  );

  let y2 = y;
  const shipName = data.shipTo.name || data.party.name || "—";
  const shipAddr = data.shipTo.address || data.party.address || "";
  const shipState = data.shipTo.stateCode || data.party.stateCode || "";
  const shipGstin = data.shipTo.gstin || data.party.gstin || "";
  y2 = wrapText(doc, shipName, col2, y2, colW - 8, 10);
  y2 = wrapText(doc, shipAddr, col2, y2, colW - 8, 10);
  y2 = wrapText(
    doc,
    shipState ? `State: ${stateName(shipState)}` : "",
    col2,
    y2,
    colW - 8,
    10,
  );
  y2 = wrapText(
    doc,
    shipGstin ? `GSTIN: ${shipGstin}` : "GSTIN: —",
    col2,
    y2,
    colW - 8,
    10,
  );

  let y3 = y;
  const meta: [string, string][] = [
    ["Inv. No.", data.number || `S-${data.voucherId}`],
    ["Date", data.date],
    ["Payment", data.paymentMode || "—"],
    ["Reverse charge", data.reverseCharge ? "YES" : "NO"],
    ["Buyer order", data.buyerOrderNo || "—"],
    ["Supplier ref", data.supplierRef || "—"],
    ["Vehicle", data.vehicleNo || "—"],
    ["Delivery", data.deliveryDate || "—"],
    ["Transport", data.transport || "—"],
    ["Terms del.", data.termsOfDelivery || "—"],
    ["POS", stateName(data.placeOfSupply)],
  ];
  for (const [k, v] of meta) {
    doc.setFont("helvetica", "bold");
    doc.text(`${k}:`, col3, y3);
    doc.setFont("helvetica", "normal");
    doc.text(String(v).slice(0, 28), col3 + 62, y3);
    y3 += 10;
  }

  y = Math.max(y1, y2, y3, topY) + 10;
  doc.setDrawColor(180);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 14;

  // Line table
  const cols = {
    sr: margin,
    desc: margin + 22,
    hsn: margin + 175,
    qty: margin + 230,
    rate: margin + 290,
    tax: margin + 345,
    gst: margin + 400,
    tot: pageWidth - margin,
  };

  ensureSpace(40);
  doc.setFillColor(232, 241, 244);
  doc.rect(margin, y - 10, innerW, 18, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Sr", cols.sr, y);
  doc.text("Description", cols.desc, y);
  doc.text("HSN", cols.hsn, y);
  doc.text("Qty", cols.qty, y);
  doc.text("Rate", cols.rate, y);
  doc.text("Taxable", cols.tax, y);
  doc.text("GST", cols.gst, y);
  doc.text("Total", cols.tot, y, { align: "right" });
  y += 14;
  doc.setFont("helvetica", "normal");

  let subQty = 0;
  let subTaxable = 0;
  let subGst = 0;
  let subTotal = 0;

  data.lines.forEach((line, i) => {
    ensureSpace(40);
    const qtyLabel =
      line.qty != null
        ? `${line.qty}${line.unit ? ` ${line.unit}` : ""}`
        : "—";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(String(i + 1), cols.sr, y);
    doc.text(line.description.slice(0, 28), cols.desc, y);
    doc.text(line.hsnSac || "—", cols.hsn, y);
    doc.text(qtyLabel, cols.qty, y);
    doc.text(line.rate != null ? money(line.rate) : "—", cols.rate, y);
    doc.text(money(line.taxable), cols.tax, y);
    doc.text(`${line.gstRate}% / ${money(line.gstAmount)}`, cols.gst, y);
    doc.text(money(line.lineTotal), cols.tot, y, { align: "right" });
    y += 11;
    const detailBits = [
      line.lineDescription,
      line.batchNo ? `Batch: ${line.batchNo}` : "",
      line.serialNo ? `Serial: ${line.serialNo}` : "",
    ].filter(Boolean);
    if (detailBits.length) {
      doc.setFontSize(7);
      doc.setTextColor(90);
      y = wrapText(doc, detailBits.join(" · "), cols.desc, y, 140, 9);
      doc.setTextColor(0);
      doc.setFontSize(8);
      y += 2;
    } else {
      y += 1;
    }
    if (line.qty != null) subQty += line.qty;
    subTaxable += line.taxable;
    subGst += line.gstAmount;
    subTotal += line.lineTotal;
  });

  ensureSpace(20);
  doc.setFont("helvetica", "bold");
  doc.text("Sub-Total", cols.desc, y);
  doc.text(subQty ? String(subQty) : "—", cols.qty, y);
  doc.text(money(subTaxable), cols.tax, y);
  doc.text(money(subGst), cols.gst, y);
  doc.text(money(subTotal), cols.tot, y, { align: "right" });
  y += 16;
  doc.setDrawColor(180);
  doc.line(margin, y - 6, pageWidth - margin, y - 6);

  // Bottom: bank | totals
  ensureSpace(120);
  const bankX = margin;
  const totX = pageWidth / 2 + 20;
  const bottomTop = y;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Our Bank Details", bankX, y);
  y += 12;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const bankLines = [
    data.company.bankName ? `Bank: ${data.company.bankName}` : "",
    data.company.bankBranch ? `Branch: ${data.company.bankBranch}` : "",
    data.company.bankAccount ? `A/C No: ${data.company.bankAccount}` : "",
    data.company.bankIfsc ? `IFSC: ${data.company.bankIfsc}` : "",
    data.company.upiId ? `UPI: ${data.company.upiId}` : "",
  ].filter(Boolean);
  if (bankLines.length === 0) {
    doc.text("Add bank details under Companies → Letterhead", bankX, y);
    y += 11;
  } else {
    for (const line of bankLines) {
      doc.text(line, bankX, y);
      y += 11;
    }
  }

  let ty = bottomTop;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const totRows: [string, string, boolean?][] = [
    ["Taxable value", money(data.taxableValue)],
  ];
  if (data.isInterstate) {
    totRows.push([`IGST @ ${data.gstRate}%`, money(data.igst)]);
  } else {
    totRows.push([`CGST @ ${data.gstRate / 2}%`, money(data.cgst)]);
    totRows.push([`SGST @ ${data.gstRate / 2}%`, money(data.sgst)]);
  }
  if (data.freight) totRows.push(["Freight / packing", money(data.freight)]);
  if (data.roundOff) totRows.push(["Round off", money(data.roundOff)]);
  totRows.push(["Total Amount", money(data.total), true]);

  for (const [label, val, bold] of totRows) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, totX, ty);
    doc.text(val, pageWidth - margin, ty, { align: "right" });
    ty += 13;
  }

  y = Math.max(y, ty) + 12;
  ensureSpace(36);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Amount in words:", margin, y);
  doc.setFont("helvetica", "normal");
  y = wrapText(doc, data.amountInWords, margin + 90, y, innerW - 90, 11);
  y += 8;

  if (data.company.invoiceTerms || data.narration) {
    ensureSpace(50);
    doc.setFont("helvetica", "bold");
    doc.text("Declaration", margin, y);
    y += 11;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    if (data.company.invoiceTerms) {
      y = wrapText(doc, data.company.invoiceTerms, margin, y, innerW * 0.62, 10);
    }
    if (data.narration) {
      y = wrapText(doc, `Narration: ${data.narration}`, margin, y, innerW * 0.62, 10);
    }
  }

  ensureSpace(50);
  y = Math.max(y + 20, pageHeight - 90);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("E. & O.E.", margin, y);
  doc.setFont("helvetica", "bold");
  doc.text(`For, ${data.company.name}`, pageWidth - margin, y, {
    align: "right",
  });
  y += 28;
  doc.setFont("helvetica", "normal");
  doc.text("Authorised Signatory", pageWidth - margin, y, { align: "right" });
  y += 16;
  doc.setFontSize(9);
  doc.text("Thank You For Business With Us!", pageWidth / 2, y, {
    align: "center",
  });

  return doc;
}

export function salesInvoicePdfBase64(data: SalesInvoiceData): string {
  const doc = buildSalesInvoicePdf(data);
  const dataUri = doc.output("datauristring");
  const comma = dataUri.indexOf(",");
  return comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
}

/** Save PDF via Tauri dialog (jspdf's browser .save() does not work reliably in Tauri). */
export async function downloadSalesInvoicePdf(
  data: SalesInvoiceData,
): Promise<string | null> {
  const doc = buildSalesInvoicePdf(data);
  const defaultName = invoiceFileName(data);
  const path = await save({
    title: "Save invoice PDF",
    defaultPath: defaultName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) return null;

  const buffer = doc.output("arraybuffer");
  await writeFile(path, new Uint8Array(buffer));
  return path;
}
