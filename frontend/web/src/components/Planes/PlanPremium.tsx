import { useAuth } from '../../context/AuthContext';
import { useContratacionPremium } from '../../hooks/useContratacionPremium';
import { usePermisosPlan } from '../../hooks/usePermisosPlan';
import { Boton } from '../ui/Boton';
import { Fila } from '../ui/Seccion';
import styles from './PlanPremium.module.css';
import { MENSAJE_PLAN_ACTIVANDO, TEXTO_PRECIO_DEMO, TEXTOS_CONTRATACION } from './reglasContratacion';

const MENSAJE_SOLO_TITULAR = 'Solo la persona titular de la organización puede contratar Premium.';

/**
 * La parte de Ajustes que muestra el plan y permite contratar Premium. La lógica está en
 * `useContratacionPremium`; aquí solo se decide qué ver según lo que dice el servidor.
 */
export function PlanPremium() {
  const { usuario } = useAuth();
  const { estado, reintentar } = usePermisosPlan();
  const contratacion = useContratacionPremium({ alPlanCambiar: reintentar });

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

  const { plan } = estado.permisos;
  const esPremium = plan === 'premium';
  // Si todavía no sabemos quién es la persona, el servidor decide: contratar lo rechaza con 403.
  const esTitular = !usuario || usuario.rol === 'titular';
  const ocupado = contratacion.operacion !== null;
  const contratoActual = contratacion.contrato;
  const hayPendiente = contratoActual?.estado === 'pendiente' || contratacion.idSinCargar !== null;
  // El pago ya se aprobó: no se ofrece pagar otra vez mientras el servidor no actualice el plan.
  const pagoAprobadoSinPlan = !esPremium && contratoActual?.estado === 'exitosa';

  return (
    <>
      <Fila
        etiqueta={esPremium ? 'Plan Premium' : 'Plan Gratuito'}
        detalle={esPremium ? 'Tienes las funciones Premium.' : 'Alertas de cobro y de prueba gratis incluidas.'}
      />
      <div className={styles.pie}>
        {!esPremium && hayPendiente && (
          <>
            <p className={styles.texto}>{TEXTOS_CONTRATACION.pendiente.detalle}</p>
            <Boton
              variante="secundario"
              tamano="s"
              onClick={() => void contratacion.verificar()}
              cargando={contratacion.operacion === 'verificando'}
              disabled={ocupado}
            >
              Verificar estado
            </Boton>
            <Boton variante="sutil" tamano="s" onClick={() => void contratacion.cancelar()} disabled={ocupado}>
              Cancelar contratación
            </Boton>
          </>
        )}

        {!esPremium && !hayPendiente && !pagoAprobadoSinPlan && (
          <>
            <Boton
              variante="secundario"
              onClick={() => void contratacion.contratar()}
              cargando={contratacion.operacion === 'iniciando'}
              disabled={ocupado || !esTitular}
            >
              Mejorar a Premium
            </Boton>
            {!esTitular && <p className={styles.texto}>{MENSAJE_SOLO_TITULAR}</p>}
            {contratacion.precioDemo === true && <p className={styles.texto}>{TEXTO_PRECIO_DEMO}</p>}
          </>
        )}

        {pagoAprobadoSinPlan && (
          <>
            <p role="status" className={styles.texto}>{MENSAJE_PLAN_ACTIVANDO}</p>
            <Boton
              variante="secundario"
              tamano="s"
              onClick={() => void contratacion.verificar()}
              cargando={contratacion.operacion === 'verificando'}
              disabled={ocupado}
            >
              Verificar estado
            </Boton>
          </>
        )}
        {!esPremium && (contratoActual?.estado === 'cancelada' || contratoActual?.estado === 'fallida') && (
          <p className={styles.texto}>{TEXTOS_CONTRATACION[contratoActual.estado].detalle}</p>
        )}
        {contratacion.mensajeError && (
          <p role="alert" className={styles.texto}>
            {contratacion.mensajeError}
          </p>
        )}
      </div>
    </>
  );
}
