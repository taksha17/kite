import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import {
  askBooks,
  type AskResult,
} from "../lib/ai/askBooks";
import { aiConfigured, getAiSettings } from "../lib/db/ai";
import { useApp } from "../state/AppContext";

const EXAMPLES = [
  "How much does Agarwal owe me?",
  "What were my sales this month?",
  "Show GST collected in the last 30 days",
  "Which stock items are low (qty under 5)?",
];

function formatCell(key: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (/amount|total|balance|debit|credit|taxable|cgst|sgst|igst|value|sales|purchase|rate|opening/i.test(key)) {
      return formatInr(value);
    }
    return String(value);
  }
  return String(value);
}

export function AskPage() {
  const { company } = useApp();
  const [params, setParams] = useSearchParams();
  const [question, setQuestion] = useState(() => params.get("q") || "");
  const [aiReady, setAiReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waitSecs, setWaitSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [showSql, setShowSql] = useState(false);
  const autoRan = useRef(false);

  useEffect(() => {
    if (!company) return;
    void getAiSettings()
      .then((s) => setAiReady(aiConfigured(s)))
      .catch(() => setAiReady(false));
  }, [company]);

  useEffect(() => {
    if (!busy) {
      setWaitSecs(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setWaitSecs(Math.floor((Date.now() - started) / 1000));
    }, 500);
    return () => window.clearInterval(id);
  }, [busy]);

  async function runAsk(q: string) {
    const text = q.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setShowSql(false);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await askBooks(text, today);
      setResult(res);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("q", text);
          next.delete("go");
          return next;
        },
        { replace: true },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (
      company &&
      aiReady &&
      params.get("go") === "1" &&
      question.trim() &&
      !autoRan.current
    ) {
      autoRan.current = true;
      void runAsk(question);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, aiReady, question, params]);

  const columns = useMemo(() => {
    if (!result?.rows.length) return [] as string[];
    return Object.keys(result.rows[0]);
  }, [result]);

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void runAsk(question);
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Ask my books</h1>
          <p className="lede">
            Ask in plain English — Kite runs a read-only query on your data.
            Numbers always come from the database, never the AI.
          </p>
        </div>
        <Link className="ghost btn" to="/reports">
          Reports
        </Link>
      </header>

      {!aiReady && (
        <p className="muted">
          Set up AI under <Link to="/companies">Companies → AI quick entry</Link>{" "}
          (a free OpenRouter key works).
        </p>
      )}

      <section className="panel" style={{ maxWidth: 720 }}>
        <form onSubmit={onSubmit}>
          <label>
            Your question
            <textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="How much does Agarwal owe me?"
              disabled={busy || !aiReady}
              autoFocus
            />
          </label>
          <div className="chip-row" style={{ margin: "0.5rem 0 0.75rem" }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="chip"
                disabled={busy || !aiReady}
                onClick={() => setQuestion(ex)}
              >
                {ex}
              </button>
            ))}
          </div>
          <div className="cta-row">
            <button
              type="submit"
              className="primary btn"
              disabled={busy || !aiReady || !question.trim()}
            >
              {busy ? `Asking… ${waitSecs}s` : "Ask"}
            </button>
          </div>
        </form>
        {error && <p className="error-text">{error}</p>}
      </section>

      {result && (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2 style={{ marginTop: 0 }}>{result.title}</h2>
          <p className="notice">{result.summary}</p>
          <p className="muted small">
            Question: {result.question}
          </p>

          {result.rows.length > 0 && (
            <div className="table-scroll" style={{ marginTop: "0.75rem" }}>
              <table className="table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td
                          key={c}
                          className={
                            /amount|total|balance|debit|credit|taxable|qty|rate/i.test(
                              c,
                            )
                              ? "num"
                              : undefined
                          }
                        >
                          {formatCell(c, row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: "0.75rem" }}>
            <button
              type="button"
              className="ghost btn"
              onClick={() => setShowSql((v) => !v)}
            >
              {showSql ? "Hide SQL" : "Show SQL"}
            </button>
            {showSql && (
              <pre
                className="small"
                style={{
                  marginTop: "0.5rem",
                  padding: "0.6rem 0.75rem",
                  background: "var(--surface-2, var(--bg))",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                }}
              >
                {result.sql}
              </pre>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
