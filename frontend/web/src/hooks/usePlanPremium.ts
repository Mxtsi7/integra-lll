import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useContratacionPremium } from './useContratacionPremium';
import { usePermisosPlan } from './usePermisosPlan';

/**
 * El plan que muestran Ajustes y Perfil, y la contratación. Una sola fuente: `/usuarios/me/permisos/`.
 *
 * La contratación vive aquí, en el componente que se queda montado mientras se vuelven a leer los
 * permisos. Así un pago pendiente o aprobado no se pierde en la recarga.
 */
export function usePlanPremium() {
  const { usuario, actualizarUsuario, capturarSesion } = useAuth();
  const { estado, reintentar } = usePermisosPlan();
  const contratacion = useContratacionPremium({ alPlanCambiar: reintentar });
  const esPremium = estado.tipo === 'listo' && estado.permisos.plan === 'premium';

  // La cabecera lee el plan de `usuario` (que viene de /me). Cuando el servidor confirma el plan en
  // permisos, se copia al contexto para que la cabecera no muestre un plan viejo hasta recargar.
  useEffect(() => {
    if (estado.tipo !== 'listo' || !usuario) return;
    const planConfirmado = estado.permisos.plan === 'premium' ? 'premium' : 'gratuito';
    if (usuario.plan === planConfirmado) return;
    actualizarUsuario({ ...usuario, plan: planConfirmado }, capturarSesion());
  }, [actualizarUsuario, capturarSesion, estado, usuario]);

  return {
    estado,
    reintentar,
    contratacion,
    esPremium,
    /** Solo si el servidor confirmó que el plan es gratuito se ofrece contratar. Durante la carga o un error, no. */
    esGratuitoConfirmado: estado.tipo === 'listo' && !esPremium,
    /** El pago ya se aprobó y el plan todavía no lo refleja. Se muestra también mientras se recargan los permisos. */
    avisoActivacion: contratacion.contrato?.estado === 'exitosa' && !esPremium,
  };
}
