import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import type { JournalContext } from "./contracts";
import "./styles.css";

declare global {
  interface Window {
    __INNER_SIGNAL_JOURNAL_CONTEXT__?: JournalContext;
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("Journal application root is unavailable.");

const runtimeContext = window.__INNER_SIGNAL_JOURNAL_CONTEXT__ ?? null;
delete window.__INNER_SIGNAL_JOURNAL_CONTEXT__;

createRoot(root).render(
  <StrictMode>
    <App context={runtimeContext} />
  </StrictMode>
);
