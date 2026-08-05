import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { roleLabel, type UserRole } from "../lib/auth/permissions";
import {
  createUser,
  listAudit,
  listUsers,
  setUserActive,
  type AppUser,
  type AuditRow,
} from "../lib/db/users";
import { useApp } from "../state/AppContext";

export function UsersPage() {
  const { company, user, allowed } = useApp();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Exclude<UserRole, "owner">>("accountant");
  const [password, setPassword] = useState("");

  async function refresh() {
    setUsers(await listUsers());
    if (allowed("view_audit")) setAudit(await listAudit(50));
  }

  useEffect(() => {
    if (company && user) void refresh().catch((e) => setError(String(e)));
  }, [company, user]);

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  if (!allowed("manage_users") && !allowed("view_audit")) {
    return (
      <div className="page">
        <p className="muted">You do not have access to user administration.</p>
      </div>
    );
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await createUser({ username, displayName, role, password });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setNotice("User created.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Users & audit</h1>
          <p className="lede">
            Local logins for this company file only. Roles limit who can change
            masters vs post vouchers.
          </p>
        </div>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {allowed("manage_users") && (
        <div className="grid-2">
          <section className="panel">
            <h2>Users</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.username}</td>
                    <td>{u.display_name}</td>
                    <td>{roleLabel(u.role)}</td>
                    <td>{u.is_active ? "Active" : "Disabled"}</td>
                    <td>
                      {u.role !== "owner" && u.id !== user?.id && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={async () => {
                            await setUserActive(u.id, !u.is_active);
                            await refresh();
                          }}
                        >
                          {u.is_active ? "Disable" : "Enable"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>Add user</h2>
            <form className="form" onSubmit={onCreate}>
              <label>
                Username
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </label>
              <label>
                Display name
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
              <label>
                Role
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as Exclude<UserRole, "owner">)
                  }
                >
                  <option value="accountant">Accountant</option>
                  <option value="data_entry">Data Entry</option>
                </select>
              </label>
              <label>
                Temporary password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </label>
              <button className="primary" type="submit">
                Create user
              </button>
            </form>
          </section>
        </div>
      )}

      {allowed("view_audit") && (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2>Recent audit</h2>
          {audit.length === 0 ? (
            <p className="muted">No audit entries yet.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="muted small">{a.created_at}</td>
                    <td>{a.username}</td>
                    <td>{a.action}</td>
                    <td>
                      {a.entity_type}
                      {a.entity_id ? ` #${a.entity_id}` : ""}
                    </td>
                    <td className="muted small">{a.detail || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
