import { confirmarCorreo, getUsuarioActual, haySesionParaReenvio, reenviarVerificacion } from '@ojoalgasto/shared';
import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import VerificarCorreoPage from '../pages/VerificarCorreoPage';

/**
 * La pantalla de verificar correo conectada a la sesión (S3-AN-02).
 *
 * Cuando el backend confirma el correo, y solo si en este navegador hay una
 * sesión abierta, se vuelve a leer el usuario para que Perfil y la barra
 * superior muestren el correo nuevo sin pedir otro login. Si la sesión cambió
 * mientras se leía (se cerró, o entró otra cuenta), el contexto descarta la
 * respuesta. Si la lectura falla no pasa nada grave: el correo ya quedó
 * confirmado en el servidor y Perfil lo vuelve a leer al abrirse.
 */
export function VerificarCorreoConectado() {
  const { usuario, capturarSesion, actualizarUsuario } = useAuth();

  // Siempre el usuario de este momento: el aviso de "verificado" llega con la
  // función de cuando se montó la pantalla.
  const usuarioActual = useRef(usuario);
  useEffect(() => {
    usuarioActual.current = usuario;
  }, [usuario]);

  const releerUsuario = useCallback(() => {
    if (!haySesionParaReenvio()) return;
    const sesion = capturarSesion();
    getUsuarioActual()
      .then((leido) => {
        // /usuarios/me/ no trae todos los campos del tipo (p. ej. `plan`): se conservan los que ya había.
        actualizarUsuario({ ...usuarioActual.current, ...leido }, sesion);
      })
      .catch(() => {});
  }, [capturarSesion, actualizarUsuario]);

  return (
    <VerificarCorreoPage
      onConfirmar={confirmarCorreo}
      onReenviar={reenviarVerificacion}
      haySesion={haySesionParaReenvio}
      onVerificado={releerUsuario}
    />
  );
}
