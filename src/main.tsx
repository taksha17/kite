import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Install as a PWA when served by kite-server (never inside the Tauri shell).
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
