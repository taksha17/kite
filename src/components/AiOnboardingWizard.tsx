import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { aiChat } from "../lib/ai/client";
import {
  buildOnboardingPrompt,
  parseOnboardingProposal,
  type OnboardingProposal,
} from "../lib/ai/onboarding";
import { aiConfigured, getAiSettings } from "../lib/db/ai";
import { createLedger, listGroups, listLedgers } from "../lib/db/client";
import {
  createStockItem,
  listStockItems,
  listUnits,
} from "../lib/db/inventory";
import { useApp } from "../state/AppContext";

const DESCRIPTION_EXAMPLES = [
  "Mobile accessories shop selling chargers, earphones and covers, also do repairs",
  "Kirana wholesale trading — rice, atta, oil, masala to local retailers",
  "Freelance graphic design services for clients, mostly UPI payments",
  "Small garment boutique — ladies wear, stitching service on the side",
];

type Step = "describe" | "review" | "done";

/**
 * First-run AI setup: the owner describes the business, the AI proposes
 * ledgers/items/GST, the owner reviews and applies. Additive only — never
 * touches existing records.
 */
export function AiOnboardingWizard({ onClose }: { onClose: () => void }) {
  const { company, saveGstSettings } = useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("describe");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [proposal, setProposal] = useState<OnboardingProposal | null>(null);
  const [applyGst, setApplyGst] = useState(false);
  const [pickedLedgers, setPickedLedgers] = useState<Set<number>>(new Set());
  const [pickedItems, setPickedItems] = useState<Set<number>>(new Set());
  const [applied, setApplied] = useState<{
    ledgers: number;
    items: number;
    errors: string[];
  } | null>(null);

  useEffect(() => {
    void getAiSettings()
      .then((s) => setAiReady(aiConfigured(s)))
      .catch(() => setAiReady(false));
  }, []);

  if (!company) return null;

  async function generate() {
    if (!company || !description.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const [settings, groups, units, ledgers, items] = await Promise.all([
        getAiSettings(),
        listGroups(),
        listUnits(),
        listLedgers(),
        listStockItems(),
      ]);
      const ctx = {
        companyName: company.name,
        groups: groups.map((g) => ({ id: g.id, name: g.name })),
        units: units.map((u) => ({ id: u.id, name: u.name, symbol: u.symbol })),
        existingLedgers: ledgers.map((l) => l.name),
        existingItems: items.map((i) => i.name),
      };
      const { system, user } = buildOnboardingPrompt(ctx, description.trim());
      const raw = await aiChat(settings, system, user);
      const parsed = parseOnboardingProposal(raw, ctx);
      setProposal(parsed);
      setApplyGst(parsed.gstEnabled === true);
      setPickedLedgers(new Set(parsed.ledgers.map((_, i) => i)));
      setPickedItems(new Set(parsed.items.map((_, i) => i)));
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggle(set: Set<number>, i: number): Set<number> {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  }

  async function apply() {
    if (!company || !proposal) return;
    setBusy(true);
    setError(null);
    const errors: string[] = [];
    let ledgerCount = 0;
    let itemCount = 0;
    try {
      for (const [i, l] of proposal.ledgers.entries()) {
        if (!pickedLedgers.has(i)) continue;
        try {
          await createLedger({
            name: l.name,
            groupId: l.groupId,
            openingDebit: l.openingDebit,
            isParty:
              l.groupName === "Sundry Debtors" ||
              l.groupName === "Sundry Creditors",
          });
          ledgerCount++;
        } catch (e) {
          errors.push(`Ledger "${l.name}": ${e instanceof Error ? e.message : e}`);
        }
      }
      for (const [i, it] of proposal.items.entries()) {
        if (!pickedItems.has(i)) continue;
        try {
          await createStockItem({
            name: it.name,
            unitId: it.unitId,
            salesRate: it.salesRate,
            purchaseRate: it.purchaseRate,
            gstRate: it.gstRate ?? 18,
            hsnSac: it.hsn || undefined,
          });
          itemCount++;
        } catch (e) {
          errors.push(`Item "${it.name}": ${e instanceof Error ? e.message : e}`);
        }
      }
      if (applyGst && !company.gst_enabled) {
        await saveGstSettings({
          gstEnabled: true,
          stateCode: company.state_code || "29",
          gstin: company.gstin || "",
        });
      }
      setApplied({ ledgers: ledgerCount, items: itemCount, errors });
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const pickedCount = pickedLedgers.size + pickedItems.size;

  return (
    <section className="panel" style={{ maxWidth: 760 }}>
      <div className="panel-head">
        <h2 style={{ margin: 0 }}>Set up your books with AI</h2>
        <button type="button" className="ghost btn" onClick={onClose}>
          Close
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {step === "describe" && (
        <>
          <p className="muted small">
            Describe your business in a sentence or two — English or Hinglish.
            The AI proposes the ledgers, stock items and GST setting to start
            with. You review everything before anything is created.
          </p>
          <textarea
            rows={3}
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. I run a mobile accessories shop in Bengaluru — chargers, earphones, covers; also repair phones"
          />
          <div className="chip-row" style={{ margin: "0.5rem 0 0.75rem" }}>
            {DESCRIPTION_EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="chip"
                onClick={() => setDescription(ex)}
              >
                {ex.length > 52 ? `${ex.slice(0, 52)}…` : ex}
              </button>
            ))}
          </div>
          {aiReady === false && (
            <p className="warn-text small">
              AI quick entry isn't configured yet — add a key under Companies
              first. A free OpenRouter key takes 2 minutes and needs no card.
            </p>
          )}
          <button
            type="button"
            className="primary btn"
            disabled={busy || !description.trim() || aiReady !== true}
            onClick={() => void generate()}
          >
            {busy ? "Thinking…" : "Propose my setup"}
          </button>
        </>
      )}

      {step === "review" && proposal && (
        <>
          {proposal.warnings.length > 0 && (
            <ul className="muted small">
              {proposal.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          {proposal.ledgers.length > 0 && (
            <>
              <h3 style={{ margin: "0.4rem 0", fontSize: "1rem" }}>Ledgers</h3>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th>Name</th>
                      <th>Group</th>
                      <th className="num">Opening</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposal.ledgers.map((l, i) => (
                      <tr key={l.name}>
                        <td>
                          <input
                            type="checkbox"
                            checked={pickedLedgers.has(i)}
                            onChange={() =>
                              setPickedLedgers((s) => toggle(s, i))
                            }
                          />
                        </td>
                        <td>{l.name}</td>
                        <td className="muted">{l.groupName}</td>
                        <td className="num">
                          {l.openingDebit ? formatInr(l.openingDebit) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {proposal.items.length > 0 && (
            <>
              <h3 style={{ margin: "0.4rem 0", fontSize: "1rem" }}>
                Stock items
              </h3>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th />
                      <th>Item</th>
                      <th>Unit</th>
                      <th className="num">Sale rate</th>
                      <th className="num">GST %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposal.items.map((it, i) => (
                      <tr key={it.name}>
                        <td>
                          <input
                            type="checkbox"
                            checked={pickedItems.has(i)}
                            onChange={() => setPickedItems((s) => toggle(s, i))}
                          />
                        </td>
                        <td>{it.name}</td>
                        <td className="muted">{it.unitName}</td>
                        <td className="num">
                          {it.salesRate ? formatInr(it.salesRate) : "—"}
                        </td>
                        <td className="num">
                          {it.gstRate != null ? `${it.gstRate}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!company.gst_enabled && proposal.gstEnabled !== null && (
            <label className="check-row" style={{ marginTop: "0.6rem" }}>
              <input
                type="checkbox"
                checked={applyGst}
                onChange={(e) => setApplyGst(e.target.checked)}
              />
              Enable GST for this company (AI thinks it
              {proposal.gstEnabled ? " applies" : " doesn't apply"} — you can
              change this later)
            </label>
          )}

          <div className="cta-row" style={{ marginTop: "0.9rem" }}>
            <button
              type="button"
              className="ghost btn"
              disabled={busy}
              onClick={() => setStep("describe")}
            >
              Back
            </button>
            <button
              type="button"
              className="primary btn"
              disabled={busy || pickedCount === 0}
              onClick={() => void apply()}
            >
              {busy
                ? "Creating…"
                : `Create ${pickedCount} record${pickedCount === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}

      {step === "done" && applied && (
        <>
          <p>
            Created <strong>{applied.ledgers}</strong> ledgers and{" "}
            <strong>{applied.items}</strong> stock items
            {applyGst ? ", and enabled GST" : ""}.
          </p>
          {applied.errors.length > 0 && (
            <ul className="error-text small">
              {applied.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          <div className="cta-row">
            <button
              type="button"
              className="primary btn"
              onClick={() => navigate("/vouchers/new")}
            >
              Enter your first voucher
            </button>
            <button type="button" className="ghost btn" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </section>
  );
}
