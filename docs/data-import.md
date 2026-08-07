# Data import — migrate masters into Kite

Kite creates a seeded Indian chart of accounts when you open a new company.
**Data import** lets you bring in ledgers, parties, and stock items (with
opening balances) from Excel/CSV — including sheets exported from TallyPrime
and similar tools — so you are not typing every master from scratch.

Voucher history import is **not** in this cut. Typical cutover: import masters
+ openings as of a date, then post new vouchers only in Kite.

## In the app

1. Create / open a company.
2. Open **Data import** (sidebar, or Cmd/Ctrl-K → “Data import”).
3. Download a template **or** upload your Excel/CSV.
4. Confirm the kind (Ledgers / Parties / Stock) and column mapping.
5. Review rows (fix unknown groups, skip duplicates).
6. Import — only **ready** rows are created.

Permission: **manage ledgers** (stock also needs **manage inventory**).

## Templates

On the upload step you can download:

- `kite-import-ledgers.xlsx` — name, under/group, opening, GSTIN, state, cash/bank
- `kite-import-parties.xlsx` — name, kind (debtor/creditor), opening, GSTIN, contacts
- `kite-import-stock.xlsx` — item, unit, HSN, GST %, rates, opening qty

## Exporting from TallyPrime (Excel)

Exact menus vary by Tally release; the idea is the same:

1. Open your company in TallyPrime.
2. Export the **ledger list** / **stock item list** to **Excel** (or CSV).
3. Keep a header row with clear column names (`Ledger Name`, `Under`,
   `Opening Balance`, `GSTIN`, …).
4. Upload that file in Kite → Data import → map columns if auto-detect misses any.

Kite maps common “Under” names to its seeded groups (e.g. *Sundry Debtors*,
*Bank Accounts*). If a group is unknown, pick one in the review table.

### Opening balance sign

- Positive opening → **debit**
- Negative opening → **credit**  
  (or use separate Opening Debit / Opening Credit columns)

Parties: debtor openings are usually debit; creditor openings credit (negative
signed opening is fine).

## What is skipped

- Ledgers/items that **already exist** (same name) — skipped, not overwritten
- Account **groups** — not created; only mapped to Kite’s seeded chart
- **Vouchers** / day book history — not imported yet

## Cutover tips

- Pick a cutover date; import openings as of that date.
- Keep Tally read-only for a short parallel period if you need to verify.
- After masters are in, use **Bank import** for statement-driven payments/receipts.

## Related

- [AI-first setup](./ai-first.md)
- [Getting started](./getting-started.md)
- [Enterprise deploy](./deployment.md)
