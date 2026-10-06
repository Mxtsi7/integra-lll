import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getUsuarioActual, type Usuario } from '@ojoalgasto/shared';

interface AuthContextType {
  usuario: Usuario | null;
  cargando: boolean;
}

const AuthContext = createContext<AuthContextType>({ usuario: null, cargando: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;

    // Llamada REAL a la API
    getUsuarioActual()
      .then((datos) => {
        if (!cancelado) setUsuario(datos);
      })
      .catch((err) => {
        console.error('Error conectando a la API de usuarios:', err);
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });

    return () => {
      cancelado = true;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, cargando }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
