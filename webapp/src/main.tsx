import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<div className="app-container" />}>
      <App />
    </Suspense>
  </StrictMode>
);
