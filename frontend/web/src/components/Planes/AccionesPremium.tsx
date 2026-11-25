import { useAuth } from '../../context/AuthContext';
import { useContratacionPremium } from '../../hooks/useContratacionPremium';
import { Boton } from '../ui/Boton';
import styles from './AccionesPremium.module.css';
import { MENSAJE_PLAN_ACTIVANDO, TEXTO_PRECIO_DEMO, TEXTOS_CONTRATACION } from './reglasContratacion';

const MENSAJE_SOLO_TITULAR = 'Solo la persona titular de la organización puede contratar Premium.';

interface AccionesPremiumProps {
  /** Se llama cuando el plan puede haber cambiado, para que la pantalla que lo muestra lo vuelva a leer. */
  alPlanCambiar?: () => void;
}

/**
 * Los botones para pasar a Premium: contratar, continuar un pago pendiente, verificar o cancelar.
 * Se usa en Ajustes y en Perfil. Solo se muestra a quien todavía no tiene Premium.
 */
export function AccionesPremium({ alPlanCambiar }: AccionesPremiumProps) {
  const { usuario } = useAuth();
  const contratacion = useContratacionPremium({ alPlanCambiar });
  // Si todavía no sabemos quién es la persona, el servidor decide: contratar lo rechaza con 403.
  const esTitular = !usuario || usuario.rol === 'titular';
  const ocupado = contratacion.operacion !== null;
  const contratoActual = contratacion.contrato;
  const hayPendiente = contratoActual?.estado === 'pendiente' || contratacion.idSinCargar !== null;
  // El pago ya se aprobó: no se ofrece pagar otra vez mientras el servidor no actualice el plan.
  const pagoAprobado = contratoActual?.estado === 'exitosa';

  return (
    <div className={styles.pie}>
      {hayPendiente && (
        <>
          <p className={styles.texto}>{TEXTOS_CONTRATACION.pendiente.detalle}</p>
          <Boton
            variante="secundario"
            onClick={() => void contratacion.continuarPago()}
            cargando={contratacion.operacion === 'continuando'}
            disabled={ocupado}
          >
            Continuar al pago
          </Boton>
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

      {!hayPendiente && !pagoAprobado && (
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

      {pagoAprobado && (
        <>
          <p role="status" className={styles.texto}>
            {MENSAJE_PLAN_ACTIVANDO}
          </p>
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

      {!hayPendiente && (contratoActual?.estado === 'cancelada' || contratoActual?.estado === 'fallida') && (
        <p className={styles.texto}>{TEXTOS_CONTRATACION[contratoActual.estado].detalle}</p>
      )}
      {contratacion.mensajeError && (
        <p role="alert" className={styles.texto}>
          {contratacion.mensajeError}
        </p>
      )}
    </div>
  );
}
