import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { PerfilPage } from './pages/PerfilPage';
import { ConfiguracionPage } from './pages/ConfiguracionPage'; 
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/perfil" element={<PerfilPage />} />
      <Route path="/configuracion" element={<ConfiguracionPage />} />

    </Routes>
  );
}

