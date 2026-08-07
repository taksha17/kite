import { describe, expect, it } from "vitest";
import {
  parseCompanyName,
  parseLedgersXml,
  parseStockXml,
  parseTallyBalance,
  parseTallyQty,
  parseTallyUnit,
} from "./xml";
import { prepareTallyLedgers } from "./prepare";
import type { AccountGroupRow } from "../db/types";

describe("parseTallyBalance", () => {
  it("handles Dr/Cr suffixes", () => {
    expect(parseTallyBalance("1,234.50 Dr")).toBe(1234.5);
    expect(parseTallyBalance("500.00 Cr")).toBe(-500);
    expect(parseTallyBalance("100")).toBe(100);
  });
});

describe("parseTallyQty / unit", () => {
  it("parses qty with unit text", () => {
    expect(parseTallyQty("10.000 Nos")).toBe(10);
    expect(parseTallyQty("2 Pcs")).toBe(2);
    expect(parseTallyUnit("Nos")).toBe("Nos");
    expect(parseTallyUnit("10 Nos")).toBe("Nos");
  });
});

const SAMPLE_LEDGERS = `<?xml version="1.0"?>
<ENVELOPE>
  <BODY>
    <DATA>
      <TALLYMESSAGE>
        <LEDGER NAME="Cash" RESERVEDNAME="">
          <NAME.LIST TYPE="String"><NAME>Cash</NAME></NAME.LIST>
          <PARENT>Cash-in-Hand</PARENT>
          <OPENINGBALANCE>5000.00 Dr</OPENINGBALANCE>
        </LEDGER>
        <LEDGER NAME="HDFC Bank" RESERVEDNAME="">
          <PARENT>Bank Accounts</PARENT>
          <OPENINGBALANCE>12000.00 Dr</OPENINGBALANCE>
        </LEDGER>
        <LEDGER NAME="Acme Traders" RESERVEDNAME="">
          <PARENT>Sundry Debtors</PARENT>
          <OPENINGBALANCE>2500.00 Dr</OPENINGBALANCE>
          <PARTYGSTIN>24AABCT1332L1ZD</PARTYGSTIN>
          <LEDSTATENAME>Gujarat</LEDSTATENAME>
          <EMAIL>a@acme.test</EMAIL>
          <ADDRESS.LIST TYPE="String">
            <ADDRESS>Line 1</ADDRESS>
            <ADDRESS>Line 2</ADDRESS>
          </ADDRESS.LIST>
        </LEDGER>
        <LEDGER NAME="Vendor Co" RESERVEDNAME="">
          <PARENT>Sundry Creditors</PARENT>
          <OPENINGBALANCE>800.00 Cr</OPENINGBALANCE>
        </LEDGER>
        <LEDGER NAME="Profit &amp; Loss A/c" RESERVEDNAME="">
          <PARENT>Primary</PARENT>
          <OPENINGBALANCE></OPENINGBALANCE>
        </LEDGER>
      </TALLYMESSAGE>
    </DATA>
  </BODY>
</ENVELOPE>`;

const SAMPLE_STOCK = `<?xml version="1.0"?>
<ENVELOPE><BODY><DATA><TALLYMESSAGE>
  <STOCKITEM NAME="Widget A">
    <NAME.LIST><NAME>Widget A</NAME></NAME.LIST>
    <BASEUNITS>Nos</BASEUNITS>
    <OPENINGBALANCE>25.000 Nos</OPENINGBALANCE>
    <HSNCODE>8471</HSNCODE>
    <GSTRATE>18</GSTRATE>
    <OPENINGRATE>100.00</OPENINGRATE>
  </STOCKITEM>
</TALLYMESSAGE></DATA></BODY></ENVELOPE>`;

const SAMPLE_COMPANY = `<?xml version="1.0"?>
<ENVELOPE><BODY><DATA><TALLYMESSAGE>
  <COMPANY NAME="ACMY INFOTECH" RESERVEDNAME="">
    <NAME.LIST><NAME>ACMY INFOTECH</NAME></NAME.LIST>
  </COMPANY>
</TALLYMESSAGE></DATA></BODY></ENVELOPE>`;

describe("parseLedgersXml", () => {
  it("extracts ledgers with openings and party fields", () => {
    const list = parseLedgersXml(SAMPLE_LEDGERS);
    expect(list.length).toBe(5);
    const cash = list.find((l) => l.name === "Cash")!;
    expect(cash.parent).toBe("Cash-in-Hand");
    expect(cash.opening).toBe(5000);
    const party = list.find((l) => l.name === "Acme Traders")!;
    expect(party.gstin).toMatch(/24AABCT/i);
    expect(party.address).toContain("Line 1");
    const vendor = list.find((l) => l.name === "Vendor Co")!;
    expect(vendor.opening).toBe(-800);
  });
});

describe("parseStockXml", () => {
  it("extracts stock items", () => {
    const list = parseStockXml(SAMPLE_STOCK);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Widget A");
    expect(list[0].openingQty).toBe(25);
    expect(list[0].unit).toBe("Nos");
    expect(list[0].gstRate).toBe(18);
  });
});

describe("parseCompanyName", () => {
  it("reads COMPANY NAME attribute", () => {
    expect(parseCompanyName(SAMPLE_COMPANY)).toBe("ACMY INFOTECH");
  });
});

describe("prepareTallyLedgers", () => {
  const groups: AccountGroupRow[] = [
    {
      id: 1,
      name: "Cash-in-Hand",
      parent_id: null,
      nature: "assets",
      normal_balance: "debit",
      is_primary: 0,
    },
    {
      id: 2,
      name: "Bank Accounts",
      parent_id: null,
      nature: "assets",
      normal_balance: "debit",
      is_primary: 0,
    },
    {
      id: 3,
      name: "Sundry Debtors",
      parent_id: null,
      nature: "assets",
      normal_balance: "debit",
      is_primary: 0,
    },
    {
      id: 4,
      name: "Sundry Creditors",
      parent_id: null,
      nature: "liabilities",
      normal_balance: "credit",
      is_primary: 0,
    },
  ];

  it("maps parents and skips P&L", () => {
    const prepared = prepareTallyLedgers(
      parseLedgersXml(SAMPLE_LEDGERS),
      groups,
      new Set(["hdfc bank"]),
    );
    expect(prepared.find((r) => /profit/i.test(r.name))).toBeUndefined();
    const cash = prepared.find((r) => r.name === "Cash")!;
    expect(cash.status).toBe("ready");
    expect(cash.groupId).toBe(1);
    expect(cash.isCashBank).toBe(true);
    expect(cash.openingDebit).toBe(5000);

    const bank = prepared.find((r) => r.name === "HDFC Bank")!;
    expect(bank.status).toBe("skip");

    const party = prepared.find((r) => r.name === "Acme Traders")!;
    expect(party.isParty).toBe(true);
    expect(party.groupId).toBe(3);
    expect(party.email).toBe("a@acme.test");

    const vendor = prepared.find((r) => r.name === "Vendor Co")!;
    expect(vendor.openingCredit).toBe(800);
    expect(vendor.isParty).toBe(true);
  });
});
