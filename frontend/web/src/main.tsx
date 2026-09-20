import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureAuthApi } from "@ojoalgasto/shared";
import { App } from "./App";

configureAuthApi({ baseUrl: import.meta.env.VITE_API_URL });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);