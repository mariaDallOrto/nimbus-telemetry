import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AppShell } from "./routing/AppShell";
import "./styles.css";

const mountNode = document.getElementById("root");
if (!mountNode) {
  throw new Error("Root mount node #root not found in the document.");
}

createRoot(mountNode).render(
  <StrictMode>
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  </StrictMode>,
);
