import { usePermisosPlan } from '../../hooks/usePermisosPlan';
import { Boton } from '../ui/Boton';
import { Fila } from '../ui/Seccion';
import { AccionesPremium } from './AccionesPremium';

/**
 * El plan de Ajustes: qué plan tiene la persona y, si no es Premium, las acciones para contratarlo.
 * Lo que dice el servidor es lo único que cuenta para mostrar Premium.
 */
export function PlanPremium() {
  const { estado, reintentar } = usePermisosPlan();

  if (estado.tipo === 'cargando') {
    return <Fila etiqueta="Plan" detalle="Comprobando tu plan…" />;
  }

  if (estado.tipo === 'error') {
    return (
      <Fila etiqueta="Plan" detalle={estado.mensaje}>
        <Boton variante="sutil" tamano="s" onClick={reintentar}>
          Reintentar
        </Boton>
      </Fila>
    );
  }

  const esPremium = estado.permisos.plan === 'premium';

  return (
    <>
      <Fila
        etiqueta={esPremium ? 'Plan Premium' : 'Plan Gratuito'}
        detalle={esPremium ? 'Tienes las funciones Premium.' : 'Alertas de cobro y de prueba gratis incluidas.'}
      />
      {!esPremium && <AccionesPremium alPlanCambiar={reintentar} />}
    </>
  );
}
