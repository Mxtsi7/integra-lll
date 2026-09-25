import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { configurarApi, configureAuthApi, configurarManejador401} from "@ojoalgasto/shared";
import { App } from "./App";
import "./styles/theme.css";

const urlBase = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";
configurarApi({ urlBase });
configureAuthApi({ baseUrl: urlBase });
configurarManejador401(() => {
  window.location.href = "/login";
});

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);