import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/register";

// Placeholder hasta que exista la página real del panel.
function PanelStub() {
  return <p style={{ padding: 24 }}>Panel — pendiente de implementar.</p>;
}

// TODO(coordinación con PR #4 de Andrea): su rama trae layout, theme y el
// router ya montado en main.tsx. Cuando esa PR entre a main:
//   1) git pull origin main
//   2) sacar el <BrowserRouter> de acá — va a vivir en main.tsx
//   3) este archivo queda solo con <Route path="/login" .../> y
//      <Route path="/registro" .../> agregadas a las suyas
export function App() {
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