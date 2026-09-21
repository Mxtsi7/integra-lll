import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configurarApi, configureAuthApi } from "@ojoalgasto/shared";
import { App } from "./App";

const urlBase = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";
configurarApi({ urlBase });
configureAuthApi({ baseUrl: urlBase });

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);