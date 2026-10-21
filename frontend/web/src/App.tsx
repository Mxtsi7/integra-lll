import { Navigate, Route, Routes } from 'react-router-dom';
import { restablecerContrasena, solicitarRecuperacion } from '@ojoalgasto/shared';
import { DashboardPage } from './pages/DashboardPage';
import { PerfilPage } from './pages/PerfilPage';
import { ConfiguracionPage } from './pages/ConfiguracionPage';
import { SuscripcionDetallePage } from './pages/SuscripcionDetallePage';
import { ProximamentePage } from './pages/ProximamentePage';
import { ToastProvider } from './context/ToastContext';
import { CatalogosLayout } from './context/CatalogosContext';
import { AuthProvider } from './context/AuthContext';
import { RutaPrivada, SoloInvitados } from './components/RutaPrivada';
import { RecuperarContrasenaPage } from './pages/RecuperarContrasenaPage';
import { RestablecerContrasenaPage } from './pages/RestablecerContrasenaPage';
import Login from './pages/Login';
import Register from './pages/register';
import Homepage from './pages/Homepage';

// CH-06: conecta la pantalla de AN-14 con POST /api/auth/password-reset/.
// La respuesta del backend es neutra (no dice si el correo existe), así que
// la pantalla no la necesita: solo importa si la solicitud falló.
async function pedirEnlaceRecuperacion(email: string): Promise<void> {
  await solicitarRecuperacion(email);
}

// CH-07: conecta la pantalla de AN-14 con POST /api/auth/password-reset/confirm/.
// La pantalla entrega (password, token); la API recibe (token, password).
function cambiarContrasena(password: string, token: string): Promise<void> {
  return restablecerContrasena(token, password);
}

export function App() {
  return (
    // Cualquier página puede usar useToast() porque el provider envuelve las rutas.
    // AuthProvider va DENTRO de ToastProvider porque avisa por toast cuando
    // la sesión expira.
    <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Con sesión activa, /login y /registro mandan al panel. */}
          <Route element={<SoloInvitados />}>
            <Route path="/login" element={<Login />} />
            <Route path="/registro" element={<Register />} />
          </Route>

          {/* Rutas de recuperación AN-14. Quedan públicas (fuera de ambas
              guardas): el enlace de restablecer llega por correo y tiene que
              funcionar aunque haya una sesión abierta en este navegador. */}
          <Route
            path="/recuperar-contrasena"
            element={<RecuperarContrasenaPage onSolicitarRecuperacion={pedirEnlaceRecuperacion} />}
          />
          <Route
            path="/restablecer-contrasena"
            element={<RestablecerContrasenaPage onSubmitNewPassword={cambiarContrasena} />}
          />

          {/* Sin sesión válida, todo esto redirige a /login. */}
          <Route element={<RutaPrivada />}>
            <Route element={<CatalogosLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              {/* Antes era "/Home" pero el menú enlaza "/home"; React Router
                  no distingue mayúsculas por defecto, se deja igual al enlace. */}
              <Route path="/home" element={<Homepage />} />
              <Route path="/perfil" element={<PerfilPage />} />
              <Route path="/configuracion" element={<ConfiguracionPage />} />
              <Route path="/suscripciones/:id" element={<SuscripcionDetallePage />} />

              {/* Secciones del menú que todavía no tienen backend. Antes caían
                  al comodín y devolvían al Panel en silencio. */}
              <Route path="/calendario" element={<ProximamentePage seccion="calendario" />} />
              <Route path="/recomendaciones" element={<ProximamentePage seccion="recomendaciones" />} />
              <Route path="/cuentas" element={<ProximamentePage seccion="cuentas" />} />
              <Route path="/informes" element={<ProximamentePage seccion="informes" />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
