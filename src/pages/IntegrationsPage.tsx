import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  emptyShopifyConnection,
  emptyWooConnection,
  getShopifyConnection,
  getWooConnection,
  listSyncLog,
  saveShopifyConnection,
  saveWooConnection,
  type ShopifyConnection,
  type SyncLogRow,
  type WooConnection,
} from "../lib/db/integrations";
import {
  importShopifyOrders,
  importWooOrders,
  testShopify,
  testWoo,
} from "../lib/integrations/sync";
import { useApp } from "../state/AppContext";

export function IntegrationsPage() {
  const { company, allowed } = useApp();
  const [shopify, setShopify] = useState<ShopifyConnection>(emptyShopifyConnection());
  const [woo, setWoo] = useState<WooConnection>(emptyWooConnection());
  const [log, setLog] = useState<SyncLogRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setShopify(await getShopifyConnection());
    setWoo(await getWooConnection());
    setLog(await listSyncLog(50));
  }

  useEffect(() => {
    if (company) void refresh();
  }, [company]);

  if (!company) {
    return (
      <div className="page">
        <p className="muted">
          Open a <Link to="/companies">company</Link> first.
        </p>
      </div>
    );
  }

  if (!allowed("manage_company")) {
    return (
      <div className="page">
        <p className="muted">Only Owner/Accountant can manage integrations.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Integrations</h1>
          <p className="lede">
            Connect Shopify or WooCommerce and pull paid store orders into your
            books. Save credentials, test the link, then import — order→voucher
            mapping is next; connect &amp; test work today.
          </p>
        </div>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Shopify</h2>
            <span className={`pill ${shopify.enabled ? "on" : "off"}`}>
              {shopify.enabled ? "Enabled" : "Off"}
            </span>
          </div>
          <p className="help-block">
            Create a custom app in Shopify admin with{" "}
            <code>read_orders</code>, <code>read_customers</code>,{" "}
            <code>read_products</code>. Paste the Admin API access token and
            shop domain (<code>your-store.myshopify.com</code>).
          </p>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await saveShopifyConnection(shopify);
                  setNotice("Shopify connection saved.");
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label>
              Shop domain
              <input
                value={shopify.shopDomain}
                onChange={(e) =>
                  setShopify((s) => ({ ...s, shopDomain: e.target.value }))
                }
                placeholder="your-store.myshopify.com"
              />
            </label>
            <label>
              Admin API access token
              <input
                type="password"
                value={shopify.accessToken}
                onChange={(e) =>
                  setShopify((s) => ({ ...s, accessToken: e.target.value }))
                }
                autoComplete="off"
              />
            </label>
            <label>
              API version
              <input
                value={shopify.apiVersion}
                onChange={(e) =>
                  setShopify((s) => ({ ...s, apiVersion: e.target.value }))
                }
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={shopify.enabled}
                onChange={(e) =>
                  setShopify((s) => ({ ...s, enabled: e.target.checked }))
                }
              />
              Enable Shopify import
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={shopify.importPaidOnly}
                onChange={(e) =>
                  setShopify((s) => ({
                    ...s,
                    importPaidOnly: e.target.checked,
                  }))
                }
              />
              Import paid orders only
            </label>
            <div className="meta-line">
              <span className="muted small">
                Last sync: {shopify.lastSyncedAt || "never"}
              </span>
            </div>
            <div className="cta-row">
              <button className="secondary" type="submit" disabled={busy}>
                Save
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await saveShopifyConnection(shopify);
                      const r = await testShopify(shopify);
                      if (r.ok) setNotice(r.message);
                      else setError(r.message);
                      await refresh();
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
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await saveShopifyConnection(shopify);
                      const r = await importShopifyOrders();
                      setNotice(r.messages.join(" "));
                      if (r.failed) setError(`${r.failed} failed`);
                      await refresh();
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
                Import orders
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>WooCommerce</h2>
            <span className={`pill ${woo.enabled ? "on" : "off"}`}>
              {woo.enabled ? "Enabled" : "Off"}
            </span>
          </div>
          <p className="help-block">
            WooCommerce → Settings → Advanced → REST API → add a key with Read
            permission. Use your site URL and consumer key/secret.
          </p>
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                setError(null);
                try {
                  await saveWooConnection(woo);
                  setNotice("WooCommerce connection saved.");
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <label>
              Store URL
              <input
                value={woo.storeUrl}
                onChange={(e) =>
                  setWoo((s) => ({ ...s, storeUrl: e.target.value }))
                }
                placeholder="https://yourstore.com"
              />
            </label>
            <label>
              Consumer key
              <input
                value={woo.consumerKey}
                onChange={(e) =>
                  setWoo((s) => ({ ...s, consumerKey: e.target.value }))
                }
                autoComplete="off"
              />
            </label>
            <label>
              Consumer secret
              <input
                type="password"
                value={woo.consumerSecret}
                onChange={(e) =>
                  setWoo((s) => ({ ...s, consumerSecret: e.target.value }))
                }
                autoComplete="off"
              />
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={woo.enabled}
                onChange={(e) =>
                  setWoo((s) => ({ ...s, enabled: e.target.checked }))
                }
              />
              Enable WooCommerce import
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={woo.importPaidOnly}
                onChange={(e) =>
                  setWoo((s) => ({
                    ...s,
                    importPaidOnly: e.target.checked,
                  }))
                }
              />
              Import processing/completed only
            </label>
            <div className="meta-line">
              <span className="muted small">
                Last sync: {woo.lastSyncedAt || "never"}
              </span>
            </div>
            <div className="cta-row">
              <button className="secondary" type="submit" disabled={busy}>
                Save
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await saveWooConnection(woo);
                      const r = await testWoo(woo);
                      if (r.ok) setNotice(r.message);
                      else setError(r.message);
                      await refresh();
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
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => {
                  void (async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await saveWooConnection(woo);
                      const r = await importWooOrders();
                      setNotice(r.messages.join(" "));
                      if (r.failed) setError(`${r.failed} failed`);
                      await refresh();
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
                Import orders
              </button>
            </div>
          </form>
        </section>
      </div>

      <section className="panel" style={{ marginTop: "1rem" }}>
        <div className="panel-head">
          <h2>Sync log</h2>
          <span className="pill info">{log.length} entries</span>
        </div>
        {log.length === 0 ? (
          <p className="muted">No sync activity yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Source</th>
                <th>Status</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row) => (
                <tr key={row.id}>
                  <td className="mono small">{row.created_at}</td>
                  <td>{row.source}</td>
                  <td>
                    <span
                      className={`pill ${
                        row.status === "ok"
                          ? "on"
                          : row.status === "error"
                            ? "err"
                            : row.status === "skip"
                              ? "warn"
                              : "info"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="small">
                    {row.external_id ? `[${row.external_id}] ` : ""}
                    {row.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
