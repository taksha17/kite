import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { indianFyStartFor } from "../lib/accounting/engine";
import { INDIA_STATES } from "../lib/accounting/gst";
import { backupCompany, browserDownloadBackup } from "../lib/db/backup";
import {
  isBrowserMode,
  isTauriRuntime,
  remoteDownloadBackup,
} from "../lib/server/remote";
import { DataBackupHelp } from "../components/DataBackupHelp";
import { DriveBackupPanel } from "../components/DriveBackupPanel";
import type { CompanyRecord } from "../lib/db/client";
import {
  clearCompanyLogo,
  getCompanyProfile,
  getSmtpSettings,
  pickAndSaveCompanyLogo,
  saveCompanyProfile,
  saveSmtpSettings,
} from "../lib/invoice/data";
import type { SmtpSettings } from "../lib/invoice/types";
import {
  emptyNicCredentials,
  getNicCredentials,
  NIC_PRESET_URLS,
  saveNicCredentials,
  type NicEwayCredentials,
} from "../lib/db/ewaybill";
import { testNicAuth } from "../lib/ewaybill/client";
import {
  emptyIrpCredentials,
  getIrpCredentials,
  IRP_PRESET_URLS,
  saveIrpCredentials,
} from "../lib/db/einvoice";
import type { IrpCredentials } from "../lib/einvoice/types";
import { testIrpAuth } from "../lib/einvoice/client";
import { testAiConnection } from "../lib/ai/client";
import { AI_DEFAULT_MODELS, AI_MODEL_SUGGESTIONS, type AiProvider, type AiSettings } from "../lib/ai/types";
import { aiConfigured, emptyAiSettings, getAiSettings, saveAiSettings } from "../lib/db/ai";
import { useApp } from "../state/AppContext";

export function CompaniesPage() {
  const {
    companies,
    company,
    selectCompany,
    addCompany,
    saveGstSettings,
    allowed,
    user,
  } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [stateCode, setStateCode] = useState("29");
  const [gstEnabled, setGstEnabled] = useState(true);
  const [ownerUsername, setOwnerUsername] = useState("owner");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editGst, setEditGst] = useState(false);
  const [editState, setEditState] = useState("29");
  const [editGstin, setEditGstin] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [pan, setPan] = useState("");
  const [cin, setCin] = useState("");
  const [businessTagline, setBusinessTagline] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankBranch, setBankBranch] = useState("");
  const [bankAccount, setBankAccount] = useState("");
  const [bankIfsc, setBankIfsc] = useState("");
  const [upiId, setUpiId] = useState("");
  const [invoiceTerms, setInvoiceTerms] = useState("");
  const [logoPreview, setLogoPreview] = useState("");

  const [smtp, setSmtp] = useState<SmtpSettings>({
    host: "",
    port: 587,
    username: "",
    password: "",
    fromEmail: "",
    fromName: "",
    useStarttls: true,
  });

  const [nic, setNic] = useState<NicEwayCredentials>(emptyNicCredentials());
  const [irp, setIrp] = useState<IrpCredentials>(emptyIrpCredentials());
  const [ai, setAi] = useState<AiSettings>(emptyAiSettings());

  useEffect(() => {
    if (!company) return;
    setEditGst(Boolean(company.gst_enabled));
    setEditState(company.state_code || "29");
    setEditGstin(company.gstin || "");
    void Promise.all([
      getCompanyProfile(),
      getSmtpSettings(),
      getNicCredentials(),
      getIrpCredentials(),
      getAiSettings(),
    ]).then(([p, s, n, irpCreds, aiSettings]) => {
        setAddress(p.address);
        setPhone(p.phone);
        setEmail(p.email);
        setWebsite(p.website);
        setPan(p.pan);
        setCin(p.cin);
        setBusinessTagline(p.businessTagline);
        setBankName(p.bankName);
        setBankBranch(p.bankBranch);
        setBankAccount(p.bankAccount);
        setBankIfsc(p.bankIfsc);
        setUpiId(p.upiId);
        setInvoiceTerms(p.invoiceTerms);
        setLogoPreview(p.logoDataUrl);
        setSmtp(s);
        setNic({
          ...n,
          gstin: n.gstin || company.gstin || "",
        });
        setIrp({
          ...irpCreds,
          gstin: irpCreds.gstin || company.gstin || "",
        });
        setAi(aiSettings);
      },
    );
  }, [company]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await addCompany({
        name,
        fyStart: indianFyStartFor(),
        gstin: gstin || undefined,
        stateCode: stateCode || undefined,
        gstEnabled,
        ownerUsername,
        ownerPassword,
      });
      setName("");
      setGstin("");
      setOwnerPassword("");
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onBackup(c: CompanyRecord) {
    setError(null);
    setNotice(null);
    try {
      if (isTauriRuntime()) {
        const path = await backupCompany(c);
        if (path) setNotice(`Backed up “${c.name}” to ${path}`);
      } else if (isBrowserMode()) {
        const filename = await browserDownloadBackup(c);
        setNotice(`Backed up “${c.name}” as ${filename}`);
      } else {
        const filename = await remoteDownloadBackup(c.id);
        setNotice(`Backed up “${c.name}” as ${filename}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onSaveGst(e: FormEvent) {
    e.preventDefault();
    if (!company) return;
    setBusy(true);
    setError(null);
    try {
      await saveGstSettings({
        gstEnabled: editGst,
        stateCode: editState,
        gstin: editGstin,
      });
      setNotice("GST settings saved.");
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
          <h1>Companies</h1>
          <p className="lede">
            Each company is a file you own. Solo is free for one desk — back up
            regularly (see Data &amp; backup below).
          </p>
        </div>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="grid-2">
        <section className="panel">
          <h2>Your companies</h2>
          {companies.length === 0 ? (
            <p className="muted">No companies yet. Create one to start.</p>
          ) : (
            <ul className="list">
              {companies.map((c) => (
                <li key={c.id} className="list-row">
                  <div>
                    <strong>{c.name}</strong>
                    <p className="muted small">
                      FY from {c.fy_start} · {c.currency}
                      {c.gst_enabled ? " · GST on" : ""}
                      {c.gstin ? ` · ${c.gstin}` : ""}
                    </p>
                    <p className="muted small mono">{c.db_file}</p>
                  </div>
                  <div className="cta-row" style={{ marginTop: 0 }}>
                    {(isTauriRuntime() || user?.role === "owner") && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => onBackup(c)}
                      >
                        Backup
                      </button>
                    )}
                    <button
                      type="button"
                      className={company?.id === c.id ? "primary" : "secondary"}
                      onClick={async () => {
                        await selectCompany(c);
                        navigate("/");
                      }}
                    >
                      Open
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <h2>Create company</h2>
          <form className="form" onSubmit={onCreate}>
            <label>
              Company name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Traders"
                required
              />
            </label>
            <label>
              State (GST place of business)
              <select
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
              >
                {INDIA_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              GSTIN (optional)
              <input
                value={gstin}
                onChange={(e) => setGstin(e.target.value.toUpperCase())}
                placeholder="29AAAAA0000A1Z5"
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={gstEnabled}
                onChange={(e) => setGstEnabled(e.target.checked)}
              />
              Enable GST on this company
            </label>
            <label>
              Owner username
              <input
                value={ownerUsername}
                onChange={(e) => setOwnerUsername(e.target.value)}
                required
              />
            </label>
            <label>
              Owner password
              <input
                type="password"
                value={ownerPassword}
                onChange={(e) => setOwnerPassword(e.target.value)}
                minLength={6}
                required
              />
            </label>
            <p className="muted small">
              Financial year defaults to India FY starting{" "}
              {indianFyStartFor()}.
            </p>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create & open"}
            </button>
          </form>
        </section>
      </div>

      <DataBackupHelp />
      <DriveBackupPanel />

      {company && allowed("manage_company") && (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2>GST settings — {company.name}</h2>
          <form className="form" onSubmit={onSaveGst}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={editGst}
                onChange={(e) => setEditGst(e.target.checked)}
              />
              GST enabled (taxable Sales/Purchase + GSTR reports)
            </label>
            <div className="form-row">
              <label>
                Company state
                <select
                  value={editState}
                  onChange={(e) => setEditState(e.target.value)}
                >
                  {INDIA_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                GSTIN
                <input
                  value={editGstin}
                  onChange={(e) => setEditGstin(e.target.value.toUpperCase())}
                  placeholder="29AAAAA0000A1Z5"
                />
              </label>
            </div>
            <button className="secondary" type="submit" disabled={busy}>
              Save GST settings
            </button>
            <p className="muted small">
              After enabling, add parties with state/GSTIN under{" "}
              <Link to="/ledgers">Ledgers</Link>, then post GST sales/purchase.
              Reports are aids for books — not a substitute for GST portal filing.
            </p>
          </form>
        </section>
      )}

      {company && allowed("manage_company") && (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2>Invoice letterhead</h2>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await saveCompanyProfile({
                  address,
                  phone,
                  email,
                  website,
                  pan,
                  cin,
                  businessTagline,
                  bankName,
                  bankBranch,
                  bankAccount,
                  bankIfsc,
                  upiId,
                  invoiceTerms,
                });
                setNotice("Invoice letterhead saved.");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="logo-row">
              {logoPreview ? (
                <img
                  className="logo-preview"
                  src={logoPreview}
                  alt="Company logo"
                />
              ) : (
                <div className="logo-preview placeholder">No logo</div>
              )}
              <div className="cta-row" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await pickAndSaveCompanyLogo(company.slug);
                        const p = await getCompanyProfile();
                        setLogoPreview(p.logoDataUrl);
                        setNotice("Company logo saved for invoices.");
                      } catch (err) {
                        setError(
                          err instanceof Error ? err.message : String(err),
                        );
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                >
                  Upload logo
                </button>
                {logoPreview && (
                  <button
                    type="button"
                    className="ghost"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        setBusy(true);
                        try {
                          await clearCompanyLogo();
                          setLogoPreview("");
                          setNotice("Logo removed.");
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : String(err),
                          );
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            <label>
              Business tagline / category
              <input
                value={businessTagline}
                onChange={(e) => setBusinessTagline(e.target.value)}
                placeholder="General Store — City"
              />
            </label>
            <label>
              Complete address
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={"Street / building\nCity, State PIN"}
                rows={3}
              />
            </label>
            <div className="form-row">
              <label>
                Phone
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label>
                Email (used as From for invoices)
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </div>
            <label>
              Website
              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://example.com"
              />
            </label>
            <div className="form-row">
              <label>
                PAN
                <input
                  value={pan}
                  onChange={(e) => setPan(e.target.value.toUpperCase())}
                  placeholder="AAAAA0000A"
                  maxLength={10}
                />
              </label>
              <label>
                CIN (Corporate Identity Number)
                <input
                  value={cin}
                  onChange={(e) => setCin(e.target.value.toUpperCase())}
                  placeholder="U12345KA2020PTC000000"
                />
              </label>
            </div>
            <h3 style={{ margin: "0.5rem 0 0", fontSize: "1rem" }}>
              Bank details (printed on invoice)
            </h3>
            <div className="form-row">
              <label>
                Bank name
                <input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                />
              </label>
              <label>
                Branch
                <input
                  value={bankBranch}
                  onChange={(e) => setBankBranch(e.target.value)}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Account number
                <input
                  value={bankAccount}
                  onChange={(e) => setBankAccount(e.target.value)}
                />
              </label>
              <label>
                IFSC
                <input
                  value={bankIfsc}
                  onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                />
              </label>
            </div>
            <label>
              UPI ID
              <input
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="yourid@upi"
              />
            </label>
            <label>
              Declaration / terms (printed on invoice)
              <textarea
                value={invoiceTerms}
                onChange={(e) => setInvoiceTerms(e.target.value)}
                placeholder={
                  "1. Subject to local jurisdiction.\n2. Terms & conditions apply."
                }
                rows={3}
              />
            </label>
            <p className="muted small">
              PAN and CIN appear on tax invoices alongside GSTIN. Bank details
              and terms print at the foot of the invoice.
            </p>
            <button className="secondary" type="submit" disabled={busy}>
              Save letterhead
            </button>
          </form>
        </section>
      )}

      {company && allowed("manage_company") && (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2>Email (SMTP)</h2>
          <p className="muted small">
            Send invoices with PDF attached from Kite using your mail provider.
            For Gmail/Google Workspace use an App Password on port 587 with
            STARTTLS.
          </p>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await saveSmtpSettings(smtp);
                setNotice("SMTP settings saved.");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-row">
              <label>
                SMTP host
                <input
                  value={smtp.host}
                  onChange={(e) =>
                    setSmtp((s) => ({ ...s, host: e.target.value }))
                  }
                  placeholder="smtp.gmail.com"
                />
              </label>
              <label>
                Port
                <input
                  type="number"
                  value={smtp.port}
                  onChange={(e) =>
                    setSmtp((s) => ({
                      ...s,
                      port: Number(e.target.value) || 587,
                    }))
                  }
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Username
                <input
                  value={smtp.username}
                  onChange={(e) =>
                    setSmtp((s) => ({ ...s, username: e.target.value }))
                  }
                  placeholder="you@company.com"
                />
              </label>
              <label>
                Password / app password
                <input
                  type="password"
                  value={smtp.password}
                  onChange={(e) =>
                    setSmtp((s) => ({ ...s, password: e.target.value }))
                  }
                  autoComplete="new-password"
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                From email
                <input
                  type="email"
                  value={smtp.fromEmail}
                  onChange={(e) =>
                    setSmtp((s) => ({ ...s, fromEmail: e.target.value }))
                  }
                  placeholder={email || "billing@company.com"}
                />
              </label>
              <label>
                From name
                <input
                  value={smtp.fromName}
                  onChange={(e) =>
                    setSmtp((s) => ({ ...s, fromName: e.target.value }))
                  }
                  placeholder={company.name}
                />
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={smtp.useStarttls}
                onChange={(e) =>
                  setSmtp((s) => ({ ...s, useStarttls: e.target.checked }))
                }
              />
              Use STARTTLS (recommended for port 587). Uncheck for implicit TLS
              (port 465).
            </label>
            <button className="secondary" type="submit" disabled={busy}>
              Save SMTP settings
            </button>
          </form>
        </section>
      )}

      {company && allowed("manage_company") && (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2>e-Way bill (NIC API)</h2>
          <p className="muted small">
            Generate legal e-way bills from sales invoices via the NIC API.
            Register for API access on the e-way bill portal (or GSP), then paste
            sandbox credentials here first. Default base URL:{" "}
            {NIC_PRESET_URLS[nic.environment]}.
          </p>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await saveNicCredentials({
                  ...nic,
                  gstin: (nic.gstin || company.gstin || "").trim().toUpperCase(),
                });
                setNotice("NIC e-way bill credentials saved.");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-row">
              <label>
                Environment
                <select
                  value={nic.environment}
                  onChange={(e) =>
                    setNic((c) => ({
                      ...c,
                      environment: e.target.value as "sandbox" | "production",
                    }))
                  }
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label>
                Base URL override (optional)
                <input
                  value={nic.baseUrl}
                  onChange={(e) =>
                    setNic((c) => ({ ...c, baseUrl: e.target.value }))
                  }
                  placeholder={NIC_PRESET_URLS[nic.environment]}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                GSTIN
                <input
                  value={nic.gstin}
                  onChange={(e) =>
                    setNic((c) => ({ ...c, gstin: e.target.value }))
                  }
                  placeholder={company.gstin || "29AAAAA0000A1Z5"}
                />
              </label>
              <label>
                Username (API)
                <input
                  value={nic.username}
                  onChange={(e) =>
                    setNic((c) => ({ ...c, username: e.target.value }))
                  }
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Password
                <input
                  type="password"
                  value={nic.password}
                  onChange={(e) =>
                    setNic((c) => ({ ...c, password: e.target.value }))
                  }
                  autoComplete="new-password"
                />
              </label>
              <label>
                Client ID
                <input
                  value={nic.clientId}
                  onChange={(e) =>
                    setNic((c) => ({ ...c, clientId: e.target.value }))
                  }
                />
              </label>
            </div>
            <label>
              Client secret
              <input
                type="password"
                value={nic.clientSecret}
                onChange={(e) =>
                  setNic((c) => ({ ...c, clientSecret: e.target.value }))
                }
                autoComplete="new-password"
              />
            </label>
            <label>
              NIC RSA public key (PEM)
              <textarea
                value={nic.publicKeyPem}
                onChange={(e) =>
                  setNic((c) => ({ ...c, publicKeyPem: e.target.value }))
                }
                rows={5}
                placeholder={
                  "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"
                }
                spellCheck={false}
              />
            </label>
            <p className="muted small">
              Download the e-way bill public key from the NIC sandbox/portal
              developer tools. Stored only in this company&apos;s SQLite meta.
            </p>
            <div className="cta-row">
              <button className="secondary" type="submit" disabled={busy}>
                Save NIC settings
              </button>
              <button
                type="button"
                className="ghost btn"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await saveNicCredentials({
                        ...nic,
                        gstin: (nic.gstin || company.gstin || "")
                          .trim()
                          .toUpperCase(),
                      });
                      await testNicAuth();
                      setNotice("NIC Auth succeeded — credentials look good.");
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Test Auth
              </button>
            </div>
          </form>
        </section>
      )}

      {company && allowed("manage_company") && (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2>e-Invoice (IRP API)</h2>
          <p className="muted small">
            Register B2B invoices with the government e-invoice portal (IRN +
            signed QR on the invoice). Mandatory above ₹5 crore turnover;
            optional below it. Enable API access on the e-invoice portal under
            your GSTIN, then test with sandbox credentials first. Default base
            URL: {IRP_PRESET_URLS[irp.environment]}.
          </p>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await saveIrpCredentials({
                  ...irp,
                  gstin: (irp.gstin || company.gstin || "").trim().toUpperCase(),
                });
                setNotice("IRP e-invoice credentials saved.");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-row">
              <label>
                Environment
                <select
                  value={irp.environment}
                  onChange={(e) =>
                    setIrp((c) => ({
                      ...c,
                      environment: e.target.value as "sandbox" | "production",
                    }))
                  }
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <label>
                Base URL override (optional)
                <input
                  value={irp.baseUrl}
                  onChange={(e) =>
                    setIrp((c) => ({ ...c, baseUrl: e.target.value }))
                  }
                  placeholder={IRP_PRESET_URLS[irp.environment]}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                GSTIN
                <input
                  value={irp.gstin}
                  onChange={(e) =>
                    setIrp((c) => ({ ...c, gstin: e.target.value }))
                  }
                  placeholder={company.gstin || "29AAAAA0000A1Z5"}
                />
              </label>
              <label>
                Username (API)
                <input
                  value={irp.username}
                  onChange={(e) =>
                    setIrp((c) => ({ ...c, username: e.target.value }))
                  }
                  autoComplete="off"
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Password
                <input
                  type="password"
                  value={irp.password}
                  onChange={(e) =>
                    setIrp((c) => ({ ...c, password: e.target.value }))
                  }
                  autoComplete="new-password"
                />
              </label>
              <label>
                Client ID
                <input
                  value={irp.clientId}
                  onChange={(e) =>
                    setIrp((c) => ({ ...c, clientId: e.target.value }))
                  }
                />
              </label>
            </div>
            <label>
              Client secret
              <input
                type="password"
                value={irp.clientSecret}
                onChange={(e) =>
                  setIrp((c) => ({ ...c, clientSecret: e.target.value }))
                }
                autoComplete="new-password"
              />
            </label>
            <label>
              IRP RSA public key (PEM)
              <textarea
                value={irp.publicKeyPem}
                onChange={(e) =>
                  setIrp((c) => ({ ...c, publicKeyPem: e.target.value }))
                }
                rows={5}
                placeholder={
                  "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"
                }
                spellCheck={false}
              />
            </label>
            <p className="muted small">
              The e-invoice portal public key is different from the e-way bill
              one — download it from the IRP sandbox/portal developer section.
              Stored only in this company&apos;s meta.
            </p>
            <div className="cta-row">
              <button className="secondary" type="submit" disabled={busy}>
                Save IRP settings
              </button>
              <button
                type="button"
                className="ghost btn"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await saveIrpCredentials({
                        ...irp,
                        gstin: (irp.gstin || company.gstin || "")
                          .trim()
                          .toUpperCase(),
                      });
                      await testIrpAuth();
                      setNotice("IRP Auth succeeded — credentials look good.");
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Test Auth
              </button>
            </div>
          </form>
        </section>
      )}

      {company && allowed("manage_company") && (
        <section className="panel" style={{ marginTop: "1rem" }}>
          <h2>AI quick entry (optional)</h2>
          <p className="muted small">
            Type a sentence on the voucher page (“Sold 2 mice to Agarwal @799 on
            UPI”) and the AI pre-fills the form for review — it can only draft,
            never post. Bring your own API key; it is stored in this
            company&apos;s meta{isTauriRuntime() ? "" : " on the server"} and
            prompts go only to your provider.
          </p>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await saveAiSettings(ai);
                setNotice("AI quick entry settings saved.");
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="form-row">
              <label>
                Provider
                <select
                  value={ai.provider}
                  onChange={(e) =>
                    setAi((c) => ({
                      ...c,
                      provider: e.target.value as AiProvider | "",
                    }))
                  }
                >
                  <option value="">Off</option>
                  <option value="openrouter">OpenRouter — free models (recommended)</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="gemini">Google (Gemini)</option>
                </select>
              </label>
              <label>
                Model (optional)
                <input
                  value={ai.model}
                  onChange={(e) =>
                    setAi((c) => ({ ...c, model: e.target.value }))
                  }
                  placeholder={
                    ai.provider
                      ? AI_DEFAULT_MODELS[ai.provider]
                      : "Provider default"
                  }
                  list="ai-model-suggestions"
                />
                {ai.provider && (
                  <datalist id="ai-model-suggestions">
                    {AI_MODEL_SUGGESTIONS[ai.provider].map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                )}
              </label>
            </div>
            {ai.provider === "openrouter" && (
              <div
                className="muted small"
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "0.6rem 0.75rem",
                  marginBottom: "0.75rem",
                }}
              >
                <strong>Free setup (2 minutes, no card):</strong>
                <ol style={{ margin: "0.35rem 0 0.35rem 1.1rem", padding: 0 }}>
                  <li>
                    Open{" "}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noreferrer"
                    >
                      openrouter.ai/keys
                    </a>{" "}
                    and sign in (a Google account works).
                  </li>
                  <li>Click “Create Key”, copy it, paste it below, Save.</li>
                  <li>
                    Leave Model empty to use the free auto-router — it picks a
                    working free model for you.
                  </li>
                </ol>
                Free limits: 20 requests/min and 50/day — plenty for voucher
                drafting. A one-time $10 top-up raises it to 1000/day. Current
                free models:{" "}
                <a
                  href="https://openrouter.ai/collections/free-models"
                  target="_blank"
                  rel="noreferrer"
                >
                  openrouter.ai/collections/free-models
                </a>
              </div>
            )}
            <label>
              API key
              <input
                type="password"
                value={ai.apiKey}
                onChange={(e) => setAi((c) => ({ ...c, apiKey: e.target.value }))}
                autoComplete="new-password"
                placeholder="sk-…"
              />
            </label>
            <div className="cta-row">
              <button className="secondary" type="submit" disabled={busy}>
                Save AI settings
              </button>
              <button
                type="button"
                className="ghost btn"
                disabled={busy || !aiConfigured(ai)}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await saveAiSettings(ai);
                      await testAiConnection(ai);
                      setNotice("AI connection succeeded — key looks good.");
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Test connection
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
