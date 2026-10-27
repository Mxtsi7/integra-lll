import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { configurarApi, configureAuthApi } from "@ojoalgasto/shared";
import { App } from "./App";
import "./styles/theme.css";
import { iniciarTema } from './hooks/useTema';

iniciarTema();

const urlBase = import.meta.env.VITE_API_URL ?? "http://localhost:8000/api";
configurarApi({ urlBase });
configureAuthApi({ baseUrl: urlBase });
// El manejador del 401 ya no se registra acá: lo registra <AuthProvider>
// (context/AuthContext.tsx). Con `window.location.href = "/login"` la app
// se recargaba entera y se perdía el aviso de "sesión expirada"; ahora el
// contexto pasa la sesión a "anonimo" y <RutaPrivada> redirige sin recargar.

// Data router en vez de <BrowserRouter> (revisión de la PR #80, CH-16): solo
// así funciona useBlocker, que permite preguntar antes de perder cambios al
// navegar con Atrás/Adelante. Las rutas siguen declaradas en App.tsx con
// <Routes>: esta única ruta comodín monta <App/> y React Router resuelve las
// rutas descendientes igual que antes.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);