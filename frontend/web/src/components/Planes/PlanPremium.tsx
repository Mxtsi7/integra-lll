import { usePlanPremium } from '../../hooks/usePlanPremium';
import { Boton } from '../ui/Boton';
import { Fila } from '../ui/Seccion';
import { AccionesPremium } from './AccionesPremium';

/**
 * El plan de Ajustes: qué plan tiene la persona según el servidor y, si no es Premium, cómo contratarlo.
 * Las acciones siguen montadas aunque los permisos se estén volviendo a leer.
 */
export function PlanPremium() {
  const { estado, reintentar, esPremium, contratacion, esGratuitoConfirmado, avisoActivacion } = usePlanPremium();

  return (
    <>
      {estado.tipo === 'cargando' && <Fila etiqueta="Plan" detalle="Comprobando tu plan…" />}

      {estado.tipo === 'error' && (
        <Fila etiqueta="Plan" detalle={estado.mensaje}>
          <Boton variante="sutil" tamano="s" onClick={reintentar}>
            Reintentar
          </Boton>
        </Fila>
      )}

      {estado.tipo === 'listo' && (
        <Fila
          etiqueta={esPremium ? 'Plan Premium' : 'Plan Gratuito'}
          detalle={esPremium ? 'Tienes las funciones Premium.' : 'Alertas de cobro y de prueba gratis incluidas.'}
        />
      )}

      <AccionesPremium contratacion={contratacion} esGratuitoConfirmado={esGratuitoConfirmado} avisoActivacion={avisoActivacion} />
    </>
  );
}
