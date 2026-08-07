import { parseAmount } from "../dataimport/parse";
import type { TallyLedger, TallyStockItem } from "./types";

/** Probe: ask Tally for company collection (lightweight). */
export function companyProbeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Companies</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

/** Fallback probe used by many connectors when List of Companies is empty. */
export function companyAltProbeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Company</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function ledgersExportXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of Ledgers" ISMODIFY="Yes">
            <FETCH>Name, Parent, OpeningBalance, GSTIN, PartyGSTIN, LedStateName, StateName, Email, LedgerPhone, LedgerMobile, Address, PinCode, Pincode</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

export function stockExportXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of StockItems</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="List of StockItems" ISMODIFY="Yes">
            <FETCH>Name, BaseUnits, OpeningBalance, HSNCode, GSTRate, GstRate, RateOfDuty, OpeningRate, ClosingRate</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

/** Direct child / first matching tag text (case-insensitive). */
function tagText(block: string, tag: string): string {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    "i",
  );
  const m = re.exec(block);
  if (!m) return "";
  // Prefer nested <NAME> inside NAME.LIST etc.
  const inner = m[1];
  const nestedName = /<NAME(?:\s[^>]*)?>([\s\S]*?)<\/NAME>/i.exec(inner);
  const raw = nestedName ? nestedName[1] : inner;
  return decodeXmlEntities(stripCdata(raw).replace(/<[^>]+>/g, "")).trim();
}

function tagTextAny(block: string, tags: string[]): string {
  for (const t of tags) {
    const v = tagText(block, t);
    if (v) return v;
  }
  return "";
}

function attrFromOpen(openTag: string, name: string): string {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i");
  const m = re.exec(openTag);
  return m ? decodeXmlEntities(m[1]).trim() : "";
}

function addressFromBlock(block: string): string {
  const list = /<ADDRESS\.LIST(?:\s[^>]*)?>([\s\S]*?)<\/ADDRESS\.LIST>/i.exec(
    block,
  );
  if (list) {
    const parts: string[] = [];
    const re = /<ADDRESS(?:\s[^>]*)?>([\s\S]*?)<\/ADDRESS>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(list[1]))) {
      const t = decodeXmlEntities(stripCdata(m[1]).replace(/<[^>]+>/g, "")).trim();
      if (t) parts.push(t);
    }
    if (parts.length) return parts.join(", ");
  }
  return tagText(block, "ADDRESS");
}

/** Parse Tally opening like "1,234.50 Dr" / "500.00 Cr" / plain number. */
export function parseTallyBalance(raw: string): number {
  return parseAmount(raw) ?? 0;
}

/** Opening qty often "10.000 Nos" or "10 Nos = 10.000 Nos". */
export function parseTallyQty(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  const m = /(-?\d+(?:\.\d+)?)/.exec(s.replace(/,/g, ""));
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function parseTallyUnit(raw: string): string {
  const s = raw.trim();
  if (!s) return "Nos";
  const m = /\b([A-Za-z][A-Za-z./-]{0,11})\b/.exec(s);
  return m?.[1] || "Nos";
}

function eachElement(
  xml: string,
  tag: string,
  fn: (openTag: string, inner: string) => void,
): void {
  const re = new RegExp(
    `<(${tag})(\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    fn(`<${m[1]}${m[2] || ""}>`, m[3]);
  }
}

export function parseCompanyName(xml: string): string {
  let found = "";
  eachElement(xml, "COMPANY", (open, inner) => {
    if (found) return;
    found =
      attrFromOpen(open, "NAME") ||
      tagText(inner, "NAME") ||
      tagText(inner, "COMPANYNAME");
  });
  if (found) return found;

  for (const tag of ["COMPANYNAME", "COMPNAME", "SVCURRENTCOMPANY"]) {
    const t = tagText(xml, tag);
    if (t) return t;
  }
  return "";
}

export function parseLedgersXml(xml: string): TallyLedger[] {
  if (!xml.trim()) throw new Error("Tally returned invalid XML for ledgers.");
  const out: TallyLedger[] = [];
  const seen = new Set<string>();

  eachElement(xml, "LEDGER", (open, inner) => {
    const name =
      attrFromOpen(open, "NAME") ||
      tagText(inner, "NAME") ||
      tagText(inner, "LEDGERNAME");
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    out.push({
      name,
      parent: tagTextAny(inner, ["PARENT", "PARENTNAME"]),
      opening: parseTallyBalance(
        tagTextAny(inner, ["OPENINGBALANCE", "OPENINGBAL"]),
      ),
      gstin: tagTextAny(inner, ["PARTYGSTIN", "GSTIN", "LEDGERGSTIN"]),
      state: tagTextAny(inner, ["LEDSTATENAME", "STATENAME", "STATE"]),
      email: tagTextAny(inner, ["EMAIL", "LEDGEREMAIL"]),
      phone: tagTextAny(inner, [
        "LEDGERPHONE",
        "LEDGERMOBILE",
        "PHONE",
        "MOBILENUMBER",
      ]),
      address: addressFromBlock(inner),
      pin: tagTextAny(inner, ["PINCODE", "PIN"]),
    });
  });

  return out;
}

export function parseStockXml(xml: string): TallyStockItem[] {
  if (!xml.trim()) throw new Error("Tally returned invalid XML for stock items.");
  const out: TallyStockItem[] = [];
  const seen = new Set<string>();

  eachElement(xml, "STOCKITEM", (open, inner) => {
    const name =
      attrFromOpen(open, "NAME") ||
      tagText(inner, "NAME") ||
      tagText(inner, "STOCKITEMNAME");
    if (!name.trim()) return;
    const key = name.trim().toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    const unitRaw = tagTextAny(inner, ["BASEUNITS", "BASEUNIT", "DENOMINATOR"]);
    const openingRaw = tagTextAny(inner, ["OPENINGBALANCE", "OPENINGQTY"]);
    const hsn = tagTextAny(inner, ["HSNCODE", "HSN", "GSTHSNNAME"]);
    const gstRaw = tagTextAny(inner, ["GSTRATE", "RATEOFDUTY", "IGSTRATE"]);
    const rateRaw = tagTextAny(inner, ["OPENINGRATE", "RATE", "CLOSINGRATE"]);
    const rate = Math.abs(parseAmount(rateRaw) ?? 0);
    const gstRate = Math.abs(parseAmount(gstRaw) ?? 18);

    out.push({
      name: name.trim(),
      unit: parseTallyUnit(unitRaw),
      hsn,
      gstRate: gstRate || 18,
      openingQty: parseTallyQty(openingRaw),
      purchaseRate: rate,
      salesRate: rate,
    });
  });

  return out;
}

/** Detect Tally LINEERROR / empty failure responses. */
export function tallyErrorFromXml(xml: string): string | null {
  const err =
    tagText(xml, "LINEERROR") ||
    tagText(xml, "ERROR");
  if (err) return err;
  if (!xml.trim()) return "Empty response from Tally.";
  return null;
}
