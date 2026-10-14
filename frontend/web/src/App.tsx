import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { PerfilPage } from './pages/PerfilPage';
import { ConfiguracionPage } from './pages/ConfiguracionPage';
import { SuscripcionDetallePage } from './pages/SuscripcionDetallePage';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider } from './context/AuthContext';
import { RutaPrivada, SoloInvitados } from './components/RutaPrivada';
import { RecuperarContrasenaPage } from './pages/RecuperarContrasenaPage';
import { RestablecerContrasenaPage } from './pages/RestablecerContrasenaPage';
import Login from './pages/Login';
import Register from './pages/register';
import Homepage from './pages/Homepage';

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
          <Route path="/recuperar-contrasena" element={<RecuperarContrasenaPage />} />
          <Route path="/restablecer-contrasena" element={<RestablecerContrasenaPage />} />

          {/* Sin sesión válida, todo esto redirige a /login. */}
          <Route element={<RutaPrivada />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            {/* Antes era "/Home" pero el Sidebar enlaza "/home"; React Router
                no distingue mayúsculas por defecto, se deja igual al enlace. */}
            <Route path="/home" element={<Homepage />} />
            <Route path="/perfil" element={<PerfilPage />} />
            <Route path="/configuracion" element={<ConfiguracionPage />} />
            <Route path="/suscripciones/:id" element={<SuscripcionDetallePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </ToastProvider>
  );
}
