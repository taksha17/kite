import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatInr } from "../lib/accounting/engine";
import { aiConfigured, getAiSettings } from "../lib/db/ai";
import { useSpeechInput } from "../lib/ai/useSpeech";
import { runStringTurn } from "../lib/string/agent";
import type { StringMessage } from "../lib/string/types";
import { useApp } from "../state/AppContext";

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatCell(key: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (
      /amount|total|balance|debit|credit|taxable|cgst|sgst|igst|value|sales|purchase|rate|opening/i.test(
        key,
      )
    ) {
      return formatInr(value);
    }
    return String(value);
  }
  return String(value);
}

export function StringPage() {
  const { company } = useApp();
  const navigate = useNavigate();
  const [aiReady, setAiReady] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<StringMessage[]>(() => [
    {
      id: "welcome",
      role: "assistant",
      text: "Hi — I'm String. Ask about your books, dictate a sale, or say “set up my shop”. Nothing posts without you.",
      at: Date.now(),
    },
  ]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const speech = useSpeechInput((t) => setInput(t));

  useEffect(() => {
    if (!company) return;
    void getAiSettings()
      .then((s) => setAiReady(aiConfigured(s)))
      .catch(() => setAiReady(false));
  }, [company]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  async function onSend(e?: FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy || !company) return;
    if (!aiReady) {
      setError("Add an AI API key under Companies → AI quick entry.");
      return;
    }
    const companyName = company.name;
    setError(null);
    setInput("");
    setMessages((m) => [
      ...m,
      { id: uid(), role: "user", text, at: Date.now() },
    ]);
    setBusy(true);
    try {
      const result = await runStringTurn(text, companyName);
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          text: result.reply,
          detail: result.detail,
          action: result.action,
          rows: result.rows,
          at: Date.now(),
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>String</h1>
          <p className="lede">
            Your BYOK agent — voice or type. Drafts and setup need your Accept /
            Apply.{" "}
            <a
              href="https://github.com/taksha17/kite/blob/main/docs/string-agent.md"
              target="_blank"
              rel="noreferrer"
            >
              How String works
            </a>
          </p>
        </div>
        <Link className="ghost btn" to="/companies">
          AI settings
        </Link>
      </header>

      {!aiReady && (
        <p className="warn-text" role="status">
          String is off until you add a key under{" "}
          <Link to="/companies">Companies → AI quick entry</Link>.
        </p>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="panel" style={{ display: "flex", flexDirection: "column", minHeight: "420px" }}>
        <div style={{ flex: 1, overflowY: "auto", maxHeight: "55vh" }}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                marginBottom: "1rem",
                padding: "0.65rem 0.85rem",
                borderRadius: "10px",
                background:
                  msg.role === "user"
                    ? "rgba(15, 122, 138, 0.12)"
                    : "rgba(0,0,0,0.04)",
              }}
            >
              <p className="muted small" style={{ marginBottom: "0.25rem" }}>
                {msg.role === "user" ? "You" : "String"}
              </p>
              <p style={{ whiteSpace: "pre-wrap" }}>{msg.text}</p>
              {msg.detail && (
                <pre
                  className="muted small"
                  style={{
                    marginTop: "0.5rem",
                    whiteSpace: "pre-wrap",
                    fontFamily: "inherit",
                  }}
                >
                  {msg.detail}
                </pre>
              )}
              {msg.rows && msg.rows.length > 0 && (
                <div className="table-wrap" style={{ marginTop: "0.5rem", overflowX: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        {Object.keys(msg.rows[0]).map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {msg.rows.map((row, i) => (
                        <tr key={i}>
                          {Object.keys(msg.rows![0]).map((k) => (
                            <td key={k}>{formatCell(k, row[k])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {msg.action && (
                <div className="cta-row" style={{ marginTop: "0.65rem" }}>
                  <button
                    type="button"
                    className="primary btn"
                    onClick={() => navigate(msg.action!.href)}
                  >
                    {msg.action.label}
                  </button>
                </div>
              )}
            </div>
          ))}
          {busy && <p className="muted small">String is working…</p>}
          <div ref={bottomRef} />
        </div>

        <form
          className="form"
          onSubmit={(e) => void onSend(e)}
          style={{ marginTop: "1rem", borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: "0.75rem" }}
        >
          <label>
            Message
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={3}
              placeholder='e.g. “Sold 2 mice to Agarwal @799” or “How much does Agarwal owe?”'
              disabled={busy || !aiReady}
            />
          </label>
          <div className="cta-row" style={{ marginTop: "0.5rem" }}>
            {speech.supported && (
              <button
                type="button"
                className={speech.listening ? "primary btn" : "ghost btn"}
                disabled={busy || !aiReady}
                onClick={() => speech.toggle()}
              >
                {speech.listening ? "Listening… tap to stop" : "Dictate"}
              </button>
            )}
            <button
              type="submit"
              className="primary btn"
              disabled={busy || !aiReady || !input.trim()}
            >
              {busy ? "…" : "Send"}
            </button>
          </div>
          {!speech.supported && (
            <p className="muted small" style={{ marginTop: "0.35rem" }}>
              Dictate needs a browser with Web Speech (e.g. Chrome). Type works everywhere.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
