import { invoke } from "@tauri-apps/api/core";
import { getSmtpSettings } from "./data";
import { invoiceFileName, salesInvoicePdfBase64 } from "./pdf";
import type { SalesInvoiceData } from "./types";

export async function emailSalesInvoice(
  data: SalesInvoiceData,
  toEmail?: string,
): Promise<void> {
  const smtp = await getSmtpSettings();
  if (!smtp.host.trim() || !smtp.username.trim() || !smtp.password) {
    throw new Error(
      "Configure SMTP under Companies → Email (SMTP) before sending.",
    );
  }

  const to = (toEmail || data.party.email || "").trim();
  if (!to) {
    throw new Error(
      "Party has no email. Add one under Ledgers, or enter a To address.",
    );
  }

  const fromEmail = (smtp.fromEmail || data.company.email || "").trim();
  if (!fromEmail) {
    throw new Error(
      "Set company email under Invoice letterhead or SMTP From address.",
    );
  }

  const fromName = (smtp.fromName || data.company.name || "Kite").trim();
  const subject = `Tax invoice ${data.number} — ${data.company.name}`;
  const body = [
    `Dear ${data.party.name},`,
    "",
    `Please find attached tax invoice ${data.number} dated ${data.date}.`,
    `Amount: INR ${data.total.toFixed(2)}`,
    "",
    "Regards,",
    fromName,
    fromEmail,
  ].join("\n");

  await invoke("send_invoice_email", {
    args: {
      host: smtp.host.trim(),
      port: smtp.port || 587,
      username: smtp.username.trim(),
      password: smtp.password,
      fromEmail,
      fromName,
      toEmail: to,
      subject,
      body,
      pdfBase64: await salesInvoicePdfBase64(data),
      pdfFilename: invoiceFileName(data),
      useStarttls: smtp.useStarttls,
    },
  });
}
