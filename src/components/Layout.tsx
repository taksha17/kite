import { NavLink, Outlet } from "react-router-dom";
import { roleLabel } from "../lib/auth/permissions";
import { AuthGatePage } from "../pages/AuthGatePage";
import { CommandPalette } from "./CommandPalette";
import { useApp } from "../state/AppContext";

type Link = { to: string; label: string; end?: boolean; perm?: string };

const sections: { title: string; links: Link[] }[] = [
  {
    title: "Work",
    links: [
      { to: "/", label: "Home", end: true },
      { to: "/vouchers", label: "Vouchers" },
      { to: "/ask", label: "Ask" },
      { to: "/string", label: "String" },
    ],
  },
  {
    title: "Records",
    links: [
      { to: "/ledgers", label: "Ledgers" },
      { to: "/inventory", label: "Inventory" },
    ],
  },
  {
    title: "Tools",
    links: [
      { to: "/bank-import", label: "Bank import", perm: "create_voucher" },
      { to: "/serial-search", label: "Serial search", perm: "create_voucher" },
      { to: "/data-import", label: "Data import", perm: "manage_ledgers" },
      { to: "/tally-migrate", label: "Tally migrate", perm: "manage_ledgers" },
    ],
  },
  {
    title: "Insights",
    links: [
      { to: "/reports", label: "Reports" },
      { to: "/follow-up", label: "Follow-up" },
      { to: "/anomalies", label: "Anomalies" },
      { to: "/period-close", label: "Period close" },
    ],
  },
  {
    title: "Admin",
    links: [
      { to: "/companies", label: "Companies" },
      { to: "/users", label: "Users", perm: "manage_users" },
      { to: "/integrations", label: "Integrations", perm: "manage_company" },
    ],
  },
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
            {sections
              .map((section) => ({
                ...section,
                links: section.links.filter((link) => {
                  if (!link.perm) return true;
                  if (link.perm === "manage_users")
                    return allowed("manage_users") || allowed("view_audit");
                  if (link.perm === "manage_company") return allowed("manage_company");
                  if (link.perm === "manage_ledgers") return allowed("manage_ledgers");
                  if (link.perm === "manage_inventory") return allowed("manage_inventory");
                  if (link.perm === "create_voucher") return allowed("create_voucher");
                  if (link.perm === "view_reports") return allowed("view_reports");
                  return true;
                }),
              }))
              .filter((section) => section.links.length > 0)
              .map((section) => (
                <div key={section.title} className="nav-section">
                  <p className="nav-section-title">{section.title}</p>
                  {section.links.map((link) => (
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
                </div>
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
      {company && !locked && <CommandPalette />}
    </div>
  );
}
