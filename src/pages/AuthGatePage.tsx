import { useState, type FormEvent } from "react";
import { useApp } from "../state/AppContext";

export function AuthGatePage() {
  const { company, authGate, login, completeOwnerSetup, leaveCompany } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!company || authGate === "none") return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (authGate === "setup") {
        await completeOwnerSetup({ username, password, displayName });
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page hero-empty" style={{ margin: "0 auto" }}>
      <p className="eyebrow">{company.name}</p>
      <h1>{authGate === "setup" ? "Set up owner login" : "Sign in"}</h1>
      <p className="lede wide">
        {authGate === "setup"
          ? "This company has no users yet. Create the Owner account to protect the books."
          : "Enter your company username and password to continue."}
      </p>

      <form className="panel narrow form" onSubmit={onSubmit} style={{ marginTop: "1.25rem" }}>
        {authGate === "setup" && (
          <label>
            Display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Optional"
            />
          </label>
        )}
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={authGate === "setup" ? "new-password" : "current-password"}
            minLength={6}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="cta-row">
          <button className="primary" type="submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : authGate === "setup"
                ? "Create owner"
                : "Sign in"}
          </button>
          <button className="ghost" type="button" onClick={() => leaveCompany()}>
            Switch company
          </button>
        </div>
      </form>
    </div>
  );
}
