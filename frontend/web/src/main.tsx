import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { configurarApi, configureAuthApi } from "@ojoalgasto/shared";
import { App } from "./App";
import "./styles/theme.css";
import { iniciarTema } from './hooks/useTema';

iniciarTema();

const urlBase = window.ojoDesktop?.apiUrl ?? import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";
configurarApi({ urlBase });
configureAuthApi({ baseUrl: urlBase });
// El manejador del 401 ya no se registra acá: lo registra <AuthProvider>
// (context/AuthContext.tsx). Con `window.location.href = "/login"` la app
// se recargaba entera y se perdía el aviso de "sesión expirada"; ahora el
// contexto pasa la sesión a "anonimo" y <RutaPrivada> redirige sin recargar.

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
