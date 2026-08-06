import { NavLink, Outlet } from "react-router-dom";
import { roleLabel } from "../lib/auth/permissions";
import { AuthGatePage } from "../pages/AuthGatePage";
import { useApp } from "../state/AppContext";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/ledgers", label: "Ledgers" },
  { to: "/inventory", label: "Inventory" },
  { to: "/vouchers", label: "Vouchers" },
  { to: "/bank-import", label: "Bank import" },
  { to: "/reports", label: "Reports" },
  { to: "/integrations", label: "Integrations" },
  { to: "/users", label: "Users" },
  { to: "/companies", label: "Companies" },
];

export function Layout() {
  const { company, user, authGate, leaveCompany, logout, allowed } = useApp();
  const locked = Boolean(company && authGate !== "none");

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/kite.svg" alt="" className="brand-logo" />
          <div>
            <p className="brand-name">Kite</p>
            <p className="brand-tag">Books that stay light</p>
          </div>
        </div>

        {!locked && (
          <nav className="nav">
            {links
              .filter((link) => {
                if (link.to === "/users") {
                  return allowed("manage_users") || allowed("view_audit");
                }
                if (link.to === "/integrations") return allowed("manage_company");
                if (link.to === "/inventory") return allowed("manage_inventory");
                if (link.to === "/bank-import") return allowed("create_voucher");
                if (link.to === "/ledgers")
                  return allowed("manage_ledgers") || allowed("create_voucher");
                return true;
              })
              .map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    isActive ? "nav-link active" : "nav-link"
                  }
                >
                  {link.label}
                </NavLink>
              ))}
          </nav>
        )}

        <div className="sidebar-footer">
          {company ? (
            <>
              <p className="muted small">Open company</p>
              <p className="company-chip">{company.name}</p>
              {user && (
                <>
                  <p className="muted small">
                    {user.display_name} · {roleLabel(user.role)}
                  </p>
                  <button type="button" className="ghost" onClick={() => logout()}>
                    Log out
                  </button>
                </>
              )}
              <button type="button" className="ghost" onClick={() => leaveCompany()}>
                Switch company
              </button>
            </>
          ) : (
            <p className="muted small">No company open</p>
          )}
        </div>
      </aside>

      <main className="main">
        {locked ? <AuthGatePage /> : <Outlet />}
      </main>
    </div>
  );
}
