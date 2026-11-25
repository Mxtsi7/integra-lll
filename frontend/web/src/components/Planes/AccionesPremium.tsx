import { useAuth } from '../../context/AuthContext';
import type { ContratacionPremium } from '../../hooks/useContratacionPremium';
import { Boton } from '../ui/Boton';
import styles from './AccionesPremium.module.css';
import { MENSAJE_PLAN_ACTIVANDO, TEXTO_PRECIO_DEMO, TEXTOS_CONTRATACION } from './reglasContratacion';

const MENSAJE_SOLO_TITULAR = 'Solo la persona titular de la organización puede contratar Premium.';

interface AccionesPremiumProps {
  contratacion: ContratacionPremium;
  /** El servidor confirmó que el plan es gratuito. Solo entonces se ofrece contratar. */
  esGratuitoConfirmado: boolean;
  /** El pago ya se aprobó y el plan todavía no lo refleja. */
  avisoActivacion: boolean;
}

/**
 * Los botones para pasar a Premium, en Ajustes y en Perfil. Qué se ofrece lo decide `usePlanPremium`;
 * aquí solo se muestra y se llaman las acciones de la contratación.
 */
export function AccionesPremium({ contratacion, esGratuitoConfirmado, avisoActivacion }: AccionesPremiumProps) {
  const { usuario } = useAuth();
  // Si todavía no sabemos quién es la persona, el servidor decide: contratar lo rechaza con 403.
  const esTitular = !usuario || usuario.rol === 'titular';
  const ocupado = contratacion.operacion !== null;
  const contratoActual = contratacion.contrato;
  const hayPendiente = contratoActual?.estado === 'pendiente' || contratacion.idSinCargar !== null;

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

      {!hayPendiente && avisoActivacion && (
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

      {!hayPendiente && !avisoActivacion && esGratuitoConfirmado && (
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
