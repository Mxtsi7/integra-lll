import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { PerfilPage } from './pages/PerfilPage';
import { ConfiguracionPage } from './pages/ConfiguracionPage';
import { SuscripcionDetallePage } from './pages/SuscripcionDetallePage';
import { ToastProvider } from './context/ToastContext';

import Login from './pages/Login';
import Register from './pages/register';
import Homepage from './pages/Homepage';

export function App() {
  return (
// Cualquier página puede usar useToast() porque el provider envuelve las rutas.
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/Home" element={<Homepage />} />
        <Route path="/perfil" element={<PerfilPage />} />
        <Route path="/configuracion" element={<ConfiguracionPage />} />
        <Route path="/suscripciones/:id" element={<SuscripcionDetallePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ToastProvider>
  );
}
