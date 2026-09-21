import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { PerfilPage } from './pages/PerfilPage';
import { ConfiguracionPage } from './pages/ConfiguracionPage';
import { SuscripcionDetallePage } from './pages/SuscripcionDetallePage';
import Login from './pages/Login';
import Register from './pages/register';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Register />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/perfil" element={<PerfilPage />} />
      <Route path="/configuracion" element={<ConfiguracionPage />} />
      <Route path="/suscripciones/:id" element={<SuscripcionDetallePage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}