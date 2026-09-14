import { useState, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, Mail, Lock, ShieldCheck } from "lucide-react";
import "./Login.css";

// TODO: reemplazar por el cliente real generado en frontend/shared (OpenAPI)
// import { login } from "../../../shared/api/auth";

export default function Login() {
  const navigate = useNavigate();
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // await login({ correo, password });
      navigate("/panel");
    } catch (err) {
      // El backend responde con un mensaje genérico para no revelar cuál dato falló
      setError("Usuario o contraseña inválidos");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-wrap">
        <div className="login-logo">
          <Eye size={20} color="#1B2A4A" />
          <span>Ojo al Gasto</span>
        </div>

        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-heading">
            <h1>Bienvenido de nuevo</h1>
            <p>Ingresa tus datos para ver el estado de tus gastos.</p>
          </div>

          <div className="login-field">
            <label htmlFor="correo">CORREO ELECTRÓNICO</label>
            <div className="login-field-input">
              <Mail size={16} color="#8A93AB" />
              <input
                id="correo"
                type="email"
                autoComplete="email"
                placeholder="usuario@ejemplo.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="login-field">
            <label htmlFor="password">CONTRASEÑA</label>
            <div className="login-field-input">
              <Lock size={16} color="#8A93AB" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {error && <p className="login-error">{error}</p>}

          <div className="login-forgot">
            <Link to="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link>
          </div>

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? "Ingresando…" : "Iniciar sesión"}
          </button>

          <div className="login-divider">
            <span className="line" />
            <span className="dot" />
            <span className="line" />
          </div>

          <p className="login-switch">
            ¿No tienes cuenta? <Link to="/registro">Regístrate</Link>
          </p>
        </form>

        <div className="login-footnote">
          <ShieldCheck size={12} color="#8A93AB" />
          <span>Conexión cifrada de extremo a extremo</span>
        </div>
      </div>
    </div>
  );
}