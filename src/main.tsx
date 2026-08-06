import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initRuntimeMode } from "./lib/server/remote";

// Install as a PWA when served over the web (never inside the Tauri shell).
if (
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  !("__TAURI_INTERNALS__" in window)
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline caching is best-effort; the app works without it.
    });
  });
}

// Decide remote (kite-server) vs browser-local (sql.js) before first render,
// so every data-layer branch sees the settled mode.
void initRuntimeMode().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
