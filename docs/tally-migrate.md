# Migrate from Tally (live HTTP)

Kite can pull **ledgers / parties** and **stock items** (with openings) from a
**running TallyPrime** over its built-in HTTP XML server — typically
`http://127.0.0.1:9000`.

This does **not** read `.900` / `.TSF` data files. Those are Tally’s private
store. The supported path is the same one CData/ODI and other tools use: talk
to Tally while a company is open.

For Excel/CSV files (including exports), see [data-import.md](./data-import.md).

## Requirements

1. **Kite Solo** (desktop) on the **same PC** as TallyPrime  
   (browser / remote Enterprise UI cannot reliably reach localhost:9000).
2. TallyPrime running with the company loaded.
3. HTTP server enabled (default port **9000**):
   - Help → Settings → Connectivity (wording varies by release)
   - “TallyPrime acts as HTTP server” / similar → Yes
4. Permission in Kite: **manage ledgers** (stock also needs **manage inventory**).

## In the app

1. Open your Kite company.
2. **Tally migrate** (sidebar, or Cmd/Ctrl-K → “Migrate from Tally”).
3. Confirm URL (`http://127.0.0.1:9000`) → **Probe Tally**.
4. Choose **Ledgers & parties** or **Stock items** → **Pull & review**.
5. Fix any unknown groups in the review table.
6. **Create** only the **ready** rows.

Duplicates (same name already in Kite) are skipped. Nothing is overwritten.

## What is pulled

| Pull | Source (Tally) | Into Kite |
|------|----------------|-----------|
| Ledgers | Collection `List of Ledgers` | Ledgers / parties + openings, GSTIN when present |
| Stock | Collection `List of StockItems` | Stock items + opening qty, HSN, GST % when present |

Parent groups are mapped onto Kite’s seeded chart (e.g. *Sundry Debtors*).
Unknown parents show as errors until you pick a group.

## What is not pulled (yet)

- Voucher / day-book history
- Creating new account groups in Kite
- Continuous background sync (each pull is explicit + reviewed)

## Cutover tips

- Prefer a cutover date: pull openings as of that date, then post new vouchers only in Kite.
- You can pull ledgers first, then stock, then use **Pull again** for leftovers.
- If HTTP pull fails on an older Tally build, fall back to Excel export → [Data import](./data-import.md).

## Related

- [Data import (Excel/CSV)](./data-import.md)
- [Getting started](./getting-started.md)
