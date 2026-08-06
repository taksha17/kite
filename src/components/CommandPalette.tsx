import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { aiConfigured, getAiSettings } from "../lib/db/ai";
import { looksLikeBooksQuestion } from "../lib/ai/askBooks";
import { useApp } from "../state/AppContext";
import type { Permission } from "../lib/auth/permissions";

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  perm?: Permission;
  run: () => void;
}

/**
 * Universal Cmd/Ctrl-K box: type a sentence to draft a voucher with AI, or
 * match a page to jump straight to it. The AI-facing surface of the app —
 * forms stay one keystroke away as the review step.
 */
export function CommandPalette() {
  const { company, allowed } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [aiReady, setAiReady] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open && company) {
      setQuery("");
      setIndex(0);
      void getAiSettings()
        .then((s) => setAiReady(aiConfigured(s)))
        .catch(() => setAiReady(false));
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, company]);

  const close = useCallback(() => setOpen(false), []);

  const actions = useMemo<PaletteAction[]>(() => {
    if (!company) return [];
    const nav: PaletteAction[] = [
      { id: "new", label: "New voucher", hint: "manual entry form", keywords: "voucher entry sale purchase payment receipt create", perm: "create_voucher", run: () => navigate("/vouchers/new") },
      { id: "vouchers", label: "Vouchers", hint: "day book", keywords: "vouchers list daybook entries", run: () => navigate("/vouchers") },
      { id: "bank", label: "Bank import", hint: "statement to vouchers", keywords: "bank statement import csv excel reconcile", perm: "create_voucher", run: () => navigate("/bank-import") },
      { id: "ask", label: "Ask my books", hint: "natural-language Q&A", keywords: "ask question balance owe gst stock query", run: () => navigate("/ask") },
      { id: "follow", label: "Receivables follow-up", hint: "payment reminders", keywords: "follow up reminder overdue receivable whatsapp email", run: () => navigate("/follow-up") },
      { id: "close", label: "Period close", hint: "month-end checklist", keywords: "period close month end gstr checklist hsn", run: () => navigate("/period-close") },
      { id: "anomalies", label: "Anomaly watch", hint: "duplicate & odd vouchers", keywords: "anomaly duplicate unusual weekend audit", run: () => navigate("/anomalies") },
      { id: "ledgers", label: "Ledgers", hint: "parties & accounts", keywords: "ledger party customer supplier account", perm: "manage_ledgers", run: () => navigate("/ledgers") },
      { id: "inventory", label: "Inventory", hint: "stock items", keywords: "stock item inventory godown", perm: "manage_inventory", run: () => navigate("/inventory") },
      { id: "reports", label: "Reports", hint: "P&L, balance sheet, GST", keywords: "report profit loss balance trial gst gstr", run: () => navigate("/reports") },
      { id: "home", label: "Home", hint: "dashboard", keywords: "home dashboard summary", run: () => navigate("/") },
      { id: "companies", label: "Companies", hint: "settings & AI keys", keywords: "company settings gst ai key", run: () => navigate("/companies") },
    ];

    const visible = nav.filter((a) => !a.perm || allowed(a.perm));
    const q = query.trim().toLowerCase();

    const matched = q
      ? visible.filter(
          (a) =>
            a.label.toLowerCase().includes(q) || a.keywords.includes(q),
        )
      : visible;

    const list: PaletteAction[] = [...matched];
    const words = query.trim().split(/\s+/).filter(Boolean);
    const multiWord = words.length >= 2;
    const asQuestion = multiWord && looksLikeBooksQuestion(query);

    if (multiWord) {
      const draft: PaletteAction = {
        id: "draft",
        label: aiReady
          ? `Draft voucher: "${query.trim()}"`
          : `New voucher with "${query.trim()}" (AI not set up yet)`,
        hint: aiReady ? "AI quick entry" : "opens the editor",
        keywords: "",
        perm: "create_voucher",
        run: () =>
          navigate(
            `/vouchers/new?ai=${encodeURIComponent(query.trim())}${aiReady ? "&go=1" : ""}`,
          ),
      };
      if (asQuestion && aiReady) {
        list.unshift(draft);
        list.unshift({
          id: "ask-q",
          label: `Ask books: "${query.trim()}"`,
          hint: "read-only answer from your data",
          keywords: "",
          run: () =>
            navigate(
              `/ask?q=${encodeURIComponent(query.trim())}&go=1`,
            ),
        });
      } else {
        list.unshift(draft);
      }
    }

    return list.filter((a) => !a.perm || allowed(a.perm));
  }, [company, allowed, navigate, query, aiReady]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  const runAction = useCallback(
    (action: PaletteAction | undefined) => {
      if (!action) return;
      close();
      action.run();
    },
    [close],
  );

  if (!open || !company) return null;

  return (
    <div className="palette-overlay" onClick={close}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question, draft a voucher, or jump…"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, actions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              runAction(actions[index] || actions[0]);
            }
          }}
        />
        <ul className="palette-list">
          {actions.length === 0 && (
            <li className="muted small" style={{ padding: "0.5rem 0.75rem" }}>
              No matches — keep typing to draft a voucher instead.
            </li>
          )}
          {actions.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                className={`palette-item${i === index ? " active" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => runAction(a)}
              >
                <span>{a.label}</span>
                {a.hint && <span className="muted small">{a.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="muted small palette-foot">
          ↑↓ select · Enter open · Esc close
        </p>
      </div>
    </div>
  );
}
