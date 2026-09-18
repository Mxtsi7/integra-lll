import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";

// Placeholder hasta que exista la página real del panel. Sin esto,
// navigate("/panel") en Login.tsx cae en el catch-all de abajo y
// rebota de vuelta a /login, que confunde al probar el login real.
function PanelStub() {
  return <p style={{ padding: 24 }}>Panel — pendiente de implementar.</p>;
}

// TODO: agregar el resto de las rutas reales a medida que existan, y una
// verificación de sesión (token en localStorage / AuthContext) que
// proteja /panel en vez de dejarlo público como está ahora.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/panel" element={<PanelStub />} />
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}