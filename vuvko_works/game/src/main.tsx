import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./pages/App";
import "./index.css";

const container = document.getElementById("root");
if (container === null) throw new Error("no #root in the page");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
